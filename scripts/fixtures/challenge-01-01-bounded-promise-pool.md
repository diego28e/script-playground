# 01.01 · Bounded Promise Pool with Ordered Results

**Time:** 30–40 min

**Difficulty:** Medium–Hard · **Target level:** Mid-Senior / Senior · **Topics:** Promises, asynchronous JavaScript, concurrency control, error handling

## Learning objectives

1. Run asynchronous tasks with at most `concurrency` of them in flight, starting the next one the moment a slot frees, and return the results in input order.
2. Fail fast on the first rejection or synchronous throw, start nothing after it, and leave no unhandled rejection behind.
3. Prove each requirement with deterministic tests: promises you settle by hand and mock timers, not sleeps.
4. Defend the design out loud: a pool against fixed batches, its cost, what happens to running tasks, cancellation with `AbortSignal`, retries, streaming input, and concurrency against rate limits.

> **How to practise it:** as a live interview. Set a timer for **40 minutes**, talk out loud the whole time (say what you're about to do, then do it), and don't scroll below the **Solutions** line until the tests pass or the timer rings. Start with clarifying questions, as you would with an interviewer. Then answer the follow-up questions out loud, in two minutes each, before reading the model answers.

**Builds on** (the TypeScript course): 01.08 *Promises and async/await*, 06.01 *Your first generic function*, 09.00 *Promise of T*, 09.01 *Promise.all and Promise.allSettled*, 09.05 *Timeouts and cancellation with AbortSignal*.

---

## Your setup

Everything runs in **Git Bash**. Copy the starter into your own `practice/` folder (git-ignored) and work there; the starter stays clean for your next attempt.

```bash
$ cd "$CHALLENGES"
$ cp -r modules/01-async-and-concurrency/starters/01-01-bounded-promise-pool practice/
$ cd practice/01-01-bounded-promise-pool
$ node -v
v26.13.1
$ pnpm -v
12.23.0
$ pnpm install
```

`No such file or directory` on the first line? Run `echo "$CHALLENGES"`: an empty line means this window doesn't know the course folder (the course README, "Your environment"). Done this challenge before? Rename your earlier attempt first, or `cp` copies the starter over it: `mv practice/01-01-bounded-promise-pool practice/01-01-bounded-promise-pool-1`.

The project:

| File | What it is |
|---|---|
| `src/run-with-concurrency.ts` | the function to write: the spec's exact signature, with a body that throws `Not implemented` |
| `test/run-with-concurrency.test.ts` | 22 tests with `node:test`, grouped by the spec's five testing expectations, then the invalid limits |
| `package.json` | `pnpm test` runs the tests, `pnpm test:watch` re-runs them on every save, `pnpm check` type-checks |

Run the tests once before you start. Every one fails:

```bash
$ pnpm test
```

```text
$ node --test --test-timeout=5000 "test/**/*.test.ts"
▶ 1. the concurrency limit is never exceeded
  ✖ ten tasks, a limit of 3, finishing in a scrambled order (2.0065ms)
  ✖ a limit of 1 runs one task at a time (example 2) (0.182ms)
…
ℹ tests 22
ℹ suites 6
ℹ pass 0
ℹ fail 22
…
[ELIFECYCLE] Test failed. See above for more details.
```

Your times differ. You're done when `pnpm test` says `ℹ pass 22` and `pnpm check` prints only its `$ tsc` line. A test that waits for something that never happens fails after 5 seconds (`--test-timeout=5000`) instead of hanging.

---

## The challenge

### Problem

Imagine you need to make 100 asynchronous API requests. Starting all of them at once could overwhelm the external service, but executing them one at a time would be unnecessarily slow.

Implement a function that executes asynchronous tasks concurrently while limiting how many can run at the same time.

The results must be returned in the same order as the original tasks, even if the tasks finish in a different order.

### Function signature

```ts
function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]>
```

Each task is a function that starts an asynchronous operation when called. The tasks have not started when they are passed to your function.

### Requirements

1. Never have more than `concurrency` tasks running at the same time.
2. Start tasks in their original input order.
3. Whenever a task finishes successfully and another task is waiting, start the next task without waiting for the other running tasks to finish.
4. Return all results in the same order as the input array, regardless of completion order.
5. Invoke each task factory at most once.
6. Do not mutate the input array.

### Error handling

- If `concurrency` is not a positive safe integer, return a rejected promise containing an `Error`. Do not start any tasks.
- If any task rejects or throws synchronously, reject the returned promise with the original rejection reason or thrown error.
- Reject as soon as a task failure is observed, without waiting for other running tasks to finish.
- Once a failure has been observed, do not start any additional tasks.
- Tasks that have already started may continue running. Cancellation is not required.
- Subsequent failures from already-running tasks must not cause unhandled promise rejections.

### Examples

#### Example 1: Out-of-order completion

```ts
const delayAndReturn = <T>(ms: number, value: T): Promise<T> =>
  new Promise(resolve => {
    setTimeout(() => resolve(value), ms);
  });

const tasks = [
  () => delayAndReturn(50, "first"),
  () => delayAndReturn(10, "second"),
  () => delayAndReturn(30, "third"),
];

await runWithConcurrency(tasks, 2);
```

Expected result:

```ts
["first", "second", "third"]
```

Illustrative execution timeline:

- At 0 ms: the first and second tasks start.
- At approximately 10 ms: the second task finishes and the third task starts.
- At approximately 40 ms: the third task finishes.
- At approximately 50 ms: the first task finishes.

Although the tasks finish in a different order, the returned results must follow the input order.

#### Example 2: Sequential execution

```ts
await runWithConcurrency([
  () => Promise.resolve("A"),
  () => Promise.resolve("B"),
  () => Promise.resolve("C"),
], 1);
```

Expected result:

```ts
["A", "B", "C"]
```

Only one task may run at a time.

#### Example 3: Task failure

```ts
const error = new Error("Request failed");

const tasks = [
  () => Promise.reject(error),
  () => delayAndReturn(100, "second"),
  () => delayAndReturn(10, "third"),
];

await runWithConcurrency(tasks, 2);
```

Expected behavior:

- The returned promise rejects with `error`.
- The third task must never start.
- Any already-running task may finish independently.

#### Example 4: Empty input

```ts
await runWithConcurrency([], 3);
// []
```

### Edge cases

Your implementation should handle:

- An empty task array.
- A concurrency limit of 1.
- A concurrency limit larger than the number of tasks.
- Invalid limits such as `0`, `-1`, `1.5`, `NaN`, and `Infinity`.
- Invalid concurrency even when the task array is empty.
- Tasks that resolve immediately.
- Task factories that throw synchronously.
- Multiple running tasks that fail at different times.
- Tasks that resolve to falsy values, including `undefined`.

### Constraints

- Use native JavaScript and TypeScript APIs.
- Do not use third-party concurrency utilities.
- Aim for O(n) scheduling overhead, excluding the work performed by the tasks.
- Avoid busy-waiting or repeatedly polling task status.

### Testing expectations

Demonstrate that:

1. The concurrency limit is never exceeded.
2. A waiting task starts as soon as capacity becomes available.
3. Result ordering is preserved.
4. No additional tasks start after an observed failure.
5. Multiple task failures do not produce unhandled promise rejections.

## Interview follow-up questions

1. What is the difference between your implementation and processing tasks in fixed-size batches using `Promise.all()`?
2. What are the time and space complexities of your solution?
3. What happens to running tasks when the returned promise rejects?
4. How would you introduce cancellation using `AbortSignal`?
5. How would you implement retry logic without violating the concurrency limit?
6. How would you adapt this solution to process millions of tasks from an asynchronous iterator instead of an array?
7. How is concurrency limiting different from rate limiting?

---

## Solutions

> ⚠️ **Spoilers.** Only read this after your attempt: the tests pass, or the timer rang. Compare *your reasoning*, not just your code.

### Talking it through in an interview

**Clarifying questions worth asking** (and the answers this spec gives):

- "Should the first tasks start synchronously, inside the call, or is a microtask later fine?" Either; this solution starts them inside the call, and no test depends on it.
- "Do running tasks get cancelled on failure?" No: they may finish; only new starts stop.
- "Is the rejection the original reason, even a non-`Error`?" Yes: pass it through unchanged.
- "Can a factory return a plain value instead of a promise?" The type says no; wrapping it in `Promise.resolve()` costs nothing and makes it safe anyway.
- "Do you want streaming results, or the whole array at the end?" The whole array, in input order.

**The plan, said in four steps before typing:**

1. Validate `concurrency` first, and return `Promise.reject(new Error(…))`: never throw from a function that returns a promise.
2. Keep a cursor, `nextIndex`. `startNext()` takes the task at the cursor, calls it once, and writes its result into `results[index]`, which keeps the input order whatever the completion order.
3. Start `min(concurrency, n)` tasks. Each success starts exactly one more, so the number running never grows past the limit, and a freed slot is reused at once (no batches, no polling).
4. The first failure sets `failed`, rejects, and stops all starts. Every task promise gets a rejection handler, so later failures are handled, not "unhandled".

**Complexity:** O(n) time for the scheduling (each task is started once and settles once, O(1) work each), O(n) space for the results and the copied queue, and at most `concurrency` tasks in flight.

### The reference solution

`src/run-with-concurrency.ts`

```ts
export function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    return Promise.reject(new Error(`concurrency must be a positive safe integer, got ${String(concurrency)}`));
  }
  const queue = tasks.slice(); // our own copy: the caller's array is never touched again
  const results = new Array<T>(queue.length);

  return new Promise<T[]>((resolve, reject) => {
    let nextIndex = 0; // the next task to start
    let finished = 0;  // tasks that resolved
    let failed = false;

    const startNext = (): void => {
      if (failed || nextIndex >= queue.length) return;
      const index = nextIndex++;
      let running: Promise<T>;
      try {
        running = Promise.resolve(queue[index]());
      } catch (error) {
        failed = true;
        reject(error);
        return;
      }
      running.then(
        (value) => {
          if (failed) return;
          results[index] = value;
          finished++;
          if (finished === queue.length) resolve(results);
          else startNext();
        },
        (error: unknown) => {
          // Handling every rejection here is what keeps later failures from being "unhandled".
          if (failed) return;
          failed = true;
          reject(error);
        },
      );
    };

    if (queue.length === 0) {
      resolve(results);
      return;
    }
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) startNext();
  });
}
```

The decisions that matter:

- **`results[index] = value`**, not `results.push(value)`: pushing records completion order. Writing by index also keeps `undefined` results as real elements: every index is written before `resolve`, so the array has no holes.
- **One `then(onFulfilled, onRejected)` per task**, not `.then(…)` and a separate `.catch(…)`: a separate `.catch` would leave the promise returned by `.then` without a handler, and its rejection would be unhandled.
- **`failed` is checked in both handlers and in `startNext`:** after the first failure, a late success doesn't start new work, and a late failure doesn't reject twice (a second `reject` is ignored anyway, but the early return says it on purpose).
- **The `try` around the factory call** turns a synchronous throw into the same failure path as a rejection.
- **`tasks.slice()`**: the caller can't change the run by changing the array while it runs, and nothing writes to the caller's array.

### How the tests check it

- **Expectation 1:** ten tasks finish in a scrambled order while a counter tracks how many are running: never more than 3.
- **Expectation 2:** with a limit of 2, the test finishes the *second* task by hand and checks that the third starts while the first is still running. A batching solution fails here.
- **Expectation 3:** example 1 runs on `node:test`'s mock timers (`t.mock.timers.tick(10)`), so its timeline is exact and the test takes no real time. Falsy results and 50 immediate tasks keep their places.
- **Expectation 4:** example 3, plus a check that the returned promise settles while a slow task is still pending ("as soon as a failure is observed").
- **Expectation 5:** a listener on `process`'s `unhandledRejection` event collects anything unhandled while three running tasks fail at different times. It must stay empty.

The tests settle tasks with `Promise.withResolvers()` (a promise plus its `resolve` and `reject`), and `flush()` waits one turn of the event loop (`setImmediate`) so every ready callback has run before each check.

### Answers to the follow-up questions

**1. Fixed batches with `Promise.all()`.** Batches wait for the slowest task of each batch before starting the next batch. That's head-of-line blocking: one slow request leaves the other slots idle. With durations 100, 10, 10 and 10 ms and a limit of 2, batches take max(100, 10) + max(10, 10) = 110 ms. The pool takes 100 ms, because the three short tasks run one after another in the second slot while the long one runs. The pool's throughput is better whenever durations vary, which is always with real network calls. Batches are simpler to write, and their pauses can be a feature when you *want* to wait between groups.

**2. Complexity.** Time: O(n) scheduling work, since each task is started once and settles once with O(1) work in each handler; there's no sorting and no polling. Space: O(n) for the result array and the copied queue, plus O(concurrency) promises in flight. The work inside the tasks is excluded, as the spec says.

**3. Running tasks when the returned promise rejects.** Nothing happens to them: a promise can't be cancelled from outside. They keep running, and their side effects (a write, an email) still happen; the pool ignores their results and handles their rejections. If stopping them matters, they need a cancellation signal (question 4).

**4. Cancellation with `AbortSignal`.** Give each task a signal and let the pool own an `AbortController`. It aborts on the first failure, and on the caller's own signal if one is passed. Cancellation is cooperative: a task stops only if it passes the signal on (`fetch(url, { signal })`, `setTimeout` from `node:timers/promises` with `{ signal }`).

```ts
export function runWithConcurrency<T>(
  tasks: Array<(signal: AbortSignal) => Promise<T>>,
  concurrency: number,
  options: { signal?: AbortSignal } = {},
): Promise<T[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    return Promise.reject(new Error(`concurrency must be a positive safe integer, got ${String(concurrency)}`));
  }
  const queue = tasks.slice();
  const results = new Array<T>(queue.length);
  const controller = new AbortController(); // ours: aborted on the first failure, or when the caller aborts
  const outer = options.signal;

  return new Promise<T[]>((resolve, reject) => {
    let nextIndex = 0;
    let finished = 0;
    let failed = false;

    const fail = (reason: unknown): void => {
      if (failed) return;
      failed = true;
      controller.abort(reason); // tells every running task to stop
      reject(reason);
    };
    if (outer?.aborted) return fail(outer.reason);
    outer?.addEventListener("abort", () => fail(outer.reason), { once: true, signal: controller.signal });

    const startNext = (): void => {
      if (failed || nextIndex >= queue.length) return;
      const index = nextIndex++;
      let running: Promise<T>;
      try {
        running = Promise.resolve(queue[index](controller.signal));
      } catch (error) {
        return fail(error);
      }
      running.then(
        (value) => {
          if (failed) return;
          results[index] = value;
          if (++finished === queue.length) {
            controller.abort(); // only removes the listener on the caller's signal: everything has finished
            resolve(results);
          } else startNext();
        },
        fail,
      );
    };

    if (queue.length === 0) return resolve(results);
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) startNext();
  });
}
```

Run against a slow task and a failing one, the slow task's `sleep` rejects with an `AbortError` as soon as the other fails, and aborting the caller's controller rejects the pool with the caller's reason.

**5. Retries within the limit.** Retry *inside* the slot: wrap each task so that the pool sees one longer task, and the limit holds by construction.

```ts
import { setTimeout as sleep } from "node:timers/promises";

// Retries happen inside the slot: the pool sees one long task, so the limit still holds.
export function withRetry<T>(task: () => Promise<T>, attempts: number, baseDelayMs: number): () => Promise<T> {
  return async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await task();
      } catch (error) {
        if (attempt >= attempts) throw error;
        await sleep(baseDelayMs * 2 ** (attempt - 1)); // 100, 200, 400… ms
      }
    }
  };
}
```

What to say next: retry only what may succeed next time (timeouts, 5xx, 429), never a 4xx; retry only idempotent operations, or ones with an idempotency key; add jitter so clients don't retry in lockstep. Holding the slot during the back-off keeps the limit simple but wastes the slot. The alternative is to release it and put the task back at the end of the queue, which is fairer to the other tasks and slower for this one.

**6. Millions of tasks from an async iterator.** Don't build an array of a million promises or results. Pull instead of push: start `concurrency` workers that share one iterator, each taking the next task only when it's free, and hand each result to a callback instead of storing it. Memory stays O(concurrency), and a slow consumer slows the producer down: that's backpressure.

```ts
// Millions of tasks from an async iterator: N workers pull from one shared iterator, so only `concurrency` tasks
// exist at a time, and each result is handed to `onResult` instead of being kept in a huge array.
export async function forEachWithConcurrency<T>(
  source: AsyncIterable<() => Promise<T>>,
  concurrency: number,
  onResult: (value: T, index: number) => void | Promise<void>,
): Promise<number> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive safe integer");
  const iterator = source[Symbol.asyncIterator]();
  let nextIndex = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const { value: task, done } = await iterator.next(); // an async generator queues concurrent next() calls
      if (done || failed) return;
      const index = nextIndex++;
      try {
        await onResult(await task(), index);
      } catch (error) {
        failed = true;
        await iterator.return?.(); // let the source clean up (close a cursor, a file…)
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return nextIndex;
}
```

An async generator queues `next()` calls that overlap, so the workers can share it safely. Run on a generator of 1,000,000 tasks with 50 workers, this returns 1000000. If the results must come out in input order, keep a small reorder buffer, and limit how far ahead of the oldest unfinished task the workers may run. Otherwise one slow task makes the buffer grow without bound.

**7. Concurrency limiting against rate limiting.** A concurrency limit caps how many operations are in flight *at the same time*. A rate limit caps how many *start per unit of time* (100 requests per minute). They're independent: a pool of 5 with 10 ms requests starts 500 requests a second, so it still breaks a 10-requests-per-second API. To respect both, put a rate limiter in front of each start, for example a token bucket: `startNext` waits for a token before calling the factory.
