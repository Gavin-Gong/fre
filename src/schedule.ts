import { IFiber, ITask, ITaskCallback } from "./type"
import { options } from "./reconcile"

const queue: ITask[] = []
const threshold: number = 1000 / 60 // equal 16.6, SPF(milliseconds per frame)
const transitions = []
let deadline: number = 0

/**
 * @desc react 18 新 api，用于标记任务优先级，
 * @param cb
 * @link
 */
export const startTransition = (cb) => {
  transitions.push(cb) && postMessage()
}

export const schedule = (callback: any): void => {
  queue.push({ callback } as ITask)
  startTransition(flush)
}

/**
 * @desc trigger first transition task executing
 */
const postMessage = (() => {
  const cb = () => transitions.splice(0, 1).forEach((c) => c()) // execute transition first callback

  // use MessageChannel(Marcro Task) to schedule task
  if (typeof MessageChannel !== "undefined") {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = cb
    return () => port2.postMessage(null)
  }
  return () => setTimeout(cb) // fallback to setTimeout
})()

/**
 * @desc flush task queue
 */
const flush = (): void => {
  deadline = getTime() + threshold // deadline should be now ms + time of frame, beacase we should schedule a task per frame
  let job = peek(queue) // get first job of queue
  // 
  while (job && !shouldYield()) {
    const { callback } = job as any
    job.callback = null
    const next = callback()
    if (next) {
      job.callback = next as any
    } else {
      queue.shift()
    }
    job = peek(queue) //
  }
  job && startTransition(flush) // execute transition task
}

/**
 * @desc overdue or isInputPending should yield thread to CPU render
 * @returns 
 * @link https://engineering.fb.com/2019/04/22/developer-tools/isinputpending-api/
 * @link hhttps://web.dev/isinputpending/
 */
export const shouldYield = (): boolean => {
  if (options.sync) return false
  return (
    (navigator as any)?.scheduling?.isInputPending() || getTime() >= deadline
  )
}

/**
 * @desc use performance.now for time(microSecond)
 * @returns 
 * @link https://www.sitepoint.com/discovering-the-high-resolution-time-api/
 */
export const getTime = () => performance.now()

/**
 * @desc peek first task of queue
 * @param queue 
 * @returns 
 */
const peek = (queue: ITask[]) => queue[0]
