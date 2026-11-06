'use strict';
/** An error caused by an invalid user action. Message is safe to show to the user. */
class ActionError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; this.userFacing = true; }
}
class PermissionError extends ActionError {
  constructor(message = 'You do not have permission to do that.') { super(message, 'forbidden'); }
}
function assert(cond, message, code) { if (!cond) throw new ActionError(message, code); }
module.exports = { ActionError, PermissionError, assert };
