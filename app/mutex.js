/** Promise-based lock. Runs async functions one at a time, in call order. */
export class Mutex {
  #tail = Promise.resolve();

  /**
   * Runs fn after every earlier call has finished. A failure in fn is returned to the caller
   * and does not block later calls.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  run(fn) {
    const result = this.#tail.then(fn);
    this.#tail = result.catch(() => {});
    return result;
  }
}
