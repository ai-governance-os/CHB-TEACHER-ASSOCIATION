/* Google Sheets is the durable source of truth. Secrets.js is generated locally and never committed.
 * Every change is a single appended event, including its audit record. A script lock serializes writes.
 * Retrying an eventId returns the current ledger, without recording the operation twice.
 */
function doGet() {
  return json_({
    ok: true,
    service: "CHB private ledger",
    message: "Authenticated POST required.",
  });
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function doPost(e) {
  try {
    var envelope = JSON.parse(e.postData.contents);
    var config = ledgerConfig_();
    var expected = Utilities.computeHmacSha256Signature(
      envelope.body,
      config.secret,
      Utilities.Charset.UTF_8,
    )
      .map(function (b) {
        return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
      })
      .join("");
    if (
      typeof envelope.signature !== "string" ||
      envelope.signature.length !== expected.length
    )
      throw new Error("Unauthorized");
    var diff = 0;
    for (var i = 0; i < expected.length; i++)
      diff |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (diff) throw new Error("Unauthorized");
    var request = JSON.parse(envelope.body);
    if (Math.abs(Date.now() - request.at) > 120000)
      throw new Error("Expired request");
    // A write appends one complete row atomically. Reads can take a snapshot without
    // holding the global write lock, so switching books cannot queue other readers.
    if (request.action === "read") {
      return json_({
        ok: true,
        data: readLedger_(
          SpreadsheetApp.openById(config.spreadsheetId),
          bookTarget_(request.ledgerId),
        ),
      });
    }
    if (request.action === "throttle") {
      // Keep the counter atomic, but release the write lock BEFORE reading a sheet.
      var loginLock = LockService.getScriptLock();
      if (!loginLock.tryLock(20000))
        throw new Error("账本操作失败，请稍后重试");
      var allowed;
      try {
        var checked = typeof request.credentialValid === "boolean";
        var cache = CacheService.getScriptCache(),
          key = (checked ? "login-failures:" : "login:") + request.key,
          n = Number(cache.get(key) || 0);
        allowed = n < 12;
        // New counters measure failed passwords. Keep legacy callers compatible
        // during deployment. Blocked requests cannot extend the lockout forever.
        if (allowed)
          cache.put(
            key,
            String(checked && request.credentialValid ? 0 : n + 1),
            900,
          );
      } finally {
        loginLock.releaseLock();
      }
      var result = { allowed: allowed };
      if (
        allowed &&
        request.includeLedger === true &&
        (!checked || request.credentialValid)
      ) {
        result.ledger = readLedger_(
          SpreadsheetApp.openById(config.spreadsheetId),
          bookTarget_(request.ledgerId),
        );
      }
      return json_({ ok: true, data: result });
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error("账本操作失败，请稍后重试");
    try {
      var book = SpreadsheetApp.openById(config.spreadsheetId);
      var target = bookTarget_(request.ledgerId);
      if (request.action === "write") {
        var ledger = readLedger_(book, target);
        if (
          ledger.events.some(function (x) {
            return x.eventId === request.eventId;
          })
        )
          return json_({ ok: true, data: ledger });
        var old = ledger.transactions.find(function (x) {
          return x.id === request.transaction.id;
        });
        if (request.actionType) throw new Error("Invalid action");
        var action = request.operation || request.entryAction; // Vercel payload uses operation below.
        // Accept write requests only with an explicit operation; the outer action remains 'write'.
        if (!["create", "edit", "void"].includes(action))
          throw new Error("Invalid operation");
        if (action === "create" && old) throw new Error("编号重复，请刷新账本");
        if (action !== "create" && !old)
          throw new Error("找不到账目，请刷新账本");
        if (old && old.version !== request.expectedVersion)
          throw new Error("账目已被修改，请刷新后重新编辑");
        if (old && old.status === "void") throw new Error("账目已经作废");
        var t = request.transaction;
        if (t.date < ledger.openingDate) throw new Error("日期早于账本启用日");
        validateEntry_(t);
        if (action === "create" && request.expectedVersion !== 0)
          throw new Error("Invalid version");
        var now = new Date().toISOString();
        var stored = {
          id: t.id,
          date: t.date,
          type: t.type,
          category: t.category,
          description: t.description,
          amountCents: t.amountCents,
          party: t.party || "",
          note: t.note || "",
          status: action === "void" ? "void" : "active",
          version: (old ? old.version : 0) + 1,
          createdAt: old ? old.createdAt : now,
          updatedAt: now,
          operator: request.actor,
          source: old ? old.source : "app",
        };
        if (action === "void") {
          stored = Object.assign({}, old, {
            status: "void",
            note: t.note,
            version: old.version + 1,
            updatedAt: now,
            operator: request.actor,
          });
        }
        var values = [
          request.eventId,
          stored.id,
          stored.version,
          action,
          stored.date,
          stored.type,
          stored.category,
          stored.description,
          stored.amountCents / 100,
          stored.party,
          stored.note,
          stored.status,
          request.actor,
          now,
          stored.source,
          stored.createdAt,
        ].map(safeCell_);
        var sheet = book.getSheetByName(target.events);
        sheet
          .getRange(sheet.getLastRow() + 1, 1, 1, values.length)
          .setValues([values]);
        SpreadsheetApp.flush();
        // The locked snapshot already contains every earlier event. Updating it
        // in memory avoids a second full-sheet read after each append.
        var index = ledger.transactions.findIndex(function (x) {
          return x.id === stored.id;
        });
        if (index < 0) ledger.transactions.push(stored);
        else ledger.transactions[index] = stored;
        ledger.events.push({
          eventId: request.eventId,
          action: action,
          transaction: stored,
          actor: request.actor,
          at: now,
        });
        return json_({ ok: true, data: ledger });
      }
      throw new Error("Unknown operation");
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    var message = String(error.message || error);
    return json_({
      ok: false,
      error:
        message === "Unauthorized" || message === "Expired request"
          ? "Unauthorized"
          : message,
    });
  }
}
function safeCell_(value) {
  return typeof value === "string" && /^[=+@-]/.test(value)
    ? "'" + value
    : value;
}
function bookTarget_(id) {
  id = id === undefined ? "teachers" : id;
  var targets = {
    teachers: { id: "teachers", events: "账目事件", settings: "账本设置" },
    pta: { id: "pta", events: "家协账目事件", settings: "家协账本设置" },
    store: {
      id: "store",
      events: "贩卖部账目事件",
      settings: "贩卖部账本设置",
    },
  };
  if (!Object.prototype.hasOwnProperty.call(targets, id))
    throw new Error("账本无效");
  return targets[id];
}
function readLedger_(book, target) {
  target = target || bookTarget_();
  var settings = book
    .getSheetByName(target.settings)
    .getDataRange()
    .getValues()
    .slice(1)
    .reduce(function (a, r) {
      a[r[0]] = r[1];
      return a;
    }, {});
  var rows = book
    .getSheetByName(target.events)
    .getDataRange()
    .getValues()
    .slice(1);
  var latest = {},
    events = [];
  rows.forEach(function (r) {
    if (!r[0]) return;
    var t = {
      id: String(r[1]),
      version: Number(r[2]),
      date: dateString_(r[4]),
      type: String(r[5]),
      category: String(r[6]),
      description: String(r[7]),
      amountCents: Math.round(Number(r[8]) * 100),
      party: String(r[9] || ""),
      note: String(r[10] || ""),
      status: String(r[11]),
      operator: String(r[12]),
      updatedAt: iso_(r[13]),
      source: String(r[14]),
      createdAt: iso_(r[15] || r[13]),
    };
    if (!latest[t.id] || latest[t.id].version < t.version) latest[t.id] = t;
    events.push({
      eventId: String(r[0]),
      action: String(r[3]),
      transaction: t,
      actor: String(r[12]),
      at: iso_(r[13]),
    });
  });
  return {
    id: target.id,
    reviewNotes: JSON.parse(settings.reviewNotes || "[]"),
    balanceCheckpoints: JSON.parse(settings.balanceCheckpoints || "[]"),
    transactions: Object.keys(latest).map(function (k) {
      return latest[k];
    }),
    events: events,
    openingDate: dateString_(settings.openingDate),
    openingCents: Math.round(Number(settings.openingRM) * 100),
    sourceNote: String(settings.sourceNote || ""),
    spreadsheetUrl: book.getUrl(),
  };
}
function dateString_(v) {
  return v instanceof Date
    ? Utilities.formatDate(v, "Asia/Kuala_Lumpur", "yyyy-MM-dd")
    : String(v);
}
function iso_(v) {
  if (typeof v === "number")
    return new Date(Math.round((v - 25569) * 86400000)).toISOString();
  return v instanceof Date ? v.toISOString() : String(v);
}
function validateEntry_(t) {
  if (
    !t ||
    !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
    new Date(t.date + "T00:00:00Z").toISOString().slice(0, 10) !== t.date
  )
    throw new Error("Invalid date");
  if (
    !Number.isSafeInteger(t.amountCents) ||
    t.amountCents <= 0 ||
    t.amountCents > 9999999999
  )
    throw new Error("Invalid amount");
  if (
    !["income", "expense", "transfer"].includes(t.type) ||
    !t.description ||
    t.description.length > 160 ||
    t.note.length > 1500
  )
    throw new Error("Invalid entry");
}
