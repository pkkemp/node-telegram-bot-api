const debug = require('debug')('node-telegram-bot-api');
const ANOTHER_WEB_HOOK_USED = 409;


class TelegramBotPolling {
  /**
   * Handles polling against the Telegram servers.
   *
   * @param  {Function} request Function used to make HTTP requests
   * @param  {Object} options
   * @param  {Boolean|Object} options.polling Polling options
   * @param  {Number} [options.polling.timeout=10] Timeout in seconds for long polling
   * @param  {Number} [options.polling.interval=300] Interval between requests in milliseconds
   * @param  {Function} callback Function for processing a new update
   * @see https://core.telegram.org/bots/api#getupdates
   */
  constructor(request, options, callback) {
    if (typeof options.polling === 'boolean') {
      options.polling = {};
    }
    this.request = request;
    this.goptions = options;
    this.options = options.polling;
    this.options.timeout = (typeof options.timeout === 'number') ? options.timeout : 10;
    this.options.interval = (typeof options.interval === 'number') ? options.interval : 300;
    this.callback = callback;
    this._offset = 0;
    this._lastUpdate = 0;
    this._lastRequest = null;
    this._abort = false;
    this._pollingTimeout = null;
  }

  /**
   * Start polling
   * @param  {Object} [options]
   * @param  {Object} [options.restart]
   * @return {Promise}
   */
  start(options = {}) {
    if (this._lastRequest) {
      if (!options.restart) {
        return Promise.resolve();
      }
      return this.stop({
        cancel: true,
        reason: 'Polling restart',
      }).then(() => {
        return this._polling();
      });
    }
    return this._polling();
  }

  /**
   * Stop polling
   * @param  {Object} [options]
   * @param  {Boolean} [options.cancel] Cancel current request
   * @param  {String} [options.reason] Reason for stopping polling
   * @return {Promise}
   */
  stop(options = {}) {
    if (!this._lastRequest) {
      return Promise.resolve();
    }
    const lastRequest = this._lastRequest;
    this._lastRequest = null;
    clearTimeout(this._pollingTimeout);
    if (options.cancel) {
      const reason = options.reason || 'Polling stop';
      lastRequest.cancel(reason);
      return Promise.resolve();
    }
    this._abort = true;
    return lastRequest.finally(() => {
      this._abort = false;
    });
  }

  /**
   * Return `true` if is polling. Otherwise, `false`.
   */
  isPolling() {
    return !!this._lastRequest;
  }

  /**
   * Invokes polling (with recursion!)
   * @return {Promise} promise of the current request
   * @private
   */
  _polling() {
    this._lastRequest = this
      ._getUpdates()
      .then(updates => {
        this._lastUpdate = Date.now();
        debug('polling data %j', updates);
        updates.forEach(update => {
          this._offset = update.update_id;
          debug('updated offset: %s', this._offset);
          this.callback(update);
        });
      })
      .catch(err => {
        debug('polling error: %s', err.message);
        /**
         * We need to mark the already-processed items
         * to avoid fetching them again once the application
         * is restarted, or moves to next polling interval
         * (in cases where unhandled rejections do not terminate
         * the process).
         * See https://github.com/yagop/node-telegram-bot-api/issues/36#issuecomment-268532067
         */
        if (!this.goptions.badRejection) {
          throw err;
        }
        const opts = {
          qs: {
            // 'this._offset' holds ID of update that caused error
            offset: this._offset + 1,
            limit: 1,
            timeout: 0,
          },
        };
        return this.request('getUpdates', opts).then(() => {
          throw err;
        });
      })
      .finally(() => {
        if (this._abort) {
          debug('Polling is aborted!');
        } else {
          debug('setTimeout for %s miliseconds', this.options.interval);
          this._pollingTimeout = setTimeout(() => this._polling(), this.options.interval);
        }
      });
    return this._lastRequest;
  }

  /**
   * Unset current webhook. Used when we detect that a webhook has been set
   * and we are trying to poll. Polling and WebHook are mutually exclusive.
   * @see https://core.telegram.org/bots/api#getting-updates
   * @private
   */
  _unsetWebHook() {
    return this.request('setWebHook');
  }

  /**
   * Retrieve updates
   */
  _getUpdates() {
    const opts = {
      qs: {
        offset: this._offset + 1,
        limit: this.options.limit,
        timeout: this.options.timeout
      },
    };
    debug('polling with options: %j', opts);

    return this.request('getUpdates', opts)
      .catch(err => {
        if (err.response.statusCode === ANOTHER_WEB_HOOK_USED) {
          return this._unsetWebHook();
        }
        throw err;
      });
  }
}

module.exports = TelegramBotPolling;
