import {
  IFiber,
  FreElement,
  FC,
  Attributes,
  HTMLElementEx,
  FreNode,
  IEffect,
} from "./type"
import { createElement } from "./dom"
import { resetCursor } from "./hook"
import { schedule, shouldYield, startTransition } from "./schedule"
import { isArr, createText } from "./h"
import { commit } from "./commit"

let currentFiber: IFiber
let finish = null
let effect = null
let detach = null
export let options: any = {}

export const enum LANE {
  UPDATE = 1 << 1,
  INSERT = 1 << 2,
  REMOVE = 1 << 3,
  SVG = 1 << 4,
  DIRTY = 1 << 5,
}

export const render = (vnode: FreElement, node: Node, config?: any): void => {
  const rootFiber = {
    node,
    props: { children: vnode },
  } as IFiber
  if (config) options = config
  update(rootFiber)
}

export const update = (fiber?: IFiber) => {
  if (fiber && !(fiber.lane & LANE.DIRTY)) {
    fiber.lane = LANE.UPDATE | LANE.DIRTY
    schedule(() => {
      fiber.sibling = null
      effect = fiber
      detach = fiber
      reconcile(fiber)
    })
  }
}

const reconcile = (WIP?: IFiber): boolean => {
  while (WIP && !shouldYield()) WIP = capture(WIP)
  if (WIP) return reconcile.bind(null, WIP)
  // inital render
  if (finish) {
    commit(finish)
    finish = null
    options.done && options.done()
  }
  return null
}

/**
 * @desc capture WIP's(or parent) sibling
 * @param WIP 
 * @returns 
 */
const capture = (WIP: IFiber): IFiber | undefined => {
  isFn(WIP.type) ? updateHook(WIP) : updateHost(WIP)
  if (WIP.child) return WIP.child
  while (WIP) {
    bubble(WIP)
    if (!finish && WIP.lane & LANE.DIRTY) {
      finish = WIP
      WIP.lane &= ~LANE.DIRTY // mark dirty lane
      return null
    }
    if (WIP.sibling) return WIP.sibling
    WIP = WIP.parent
  }
}

/**
 * @desc find child
 * @param WIP 
 */
const bubble = (WIP) => {
  if (isFn(WIP.type)) {
    let kid = WIP.child
    while (isFn(kid.type)) {
      kid = kid.child
    }
    if (kid && WIP.sibling) {
      kid.s = WIP.sibling
      kid.lane |= WIP.lane
    }
    invokeHooks(WIP)
  } else {
    WIP.s = WIP.sibling
    effect.e = WIP
    effect = WIP
  }
}

const updateHook = <P = Attributes>(WIP: IFiber): void => {
  resetCursor()
  currentFiber = WIP
  let children = (WIP.type as FC<P>)(WIP.props)
  isStr(children) && (children = simpleVnode(children))
  diffKids(WIP, children)
}

const updateHost = (WIP: IFiber): void => {
  WIP.parentNode = getParentNode(WIP) as any

  if (!WIP.node) {
    if (WIP.type === "svg") WIP.lane |= LANE.SVG
    WIP.node = createElement(WIP) as HTMLElementEx
  }
  diffKids(WIP, WIP.props.children)
}

/**
 * @desc render function
 * @param type 
 * @param props 
 * @returns 
 */
const simpleVnode = (type: any, props?: any) =>
  isStr(type) ? createText(type as string) : isFn(type) ? type(props) : type

/**
 * @desc get parent element
 * @param WIP 
 * @returns 
 */
const getParentNode = (WIP: IFiber): HTMLElement | undefined => {
  while ((WIP = WIP.parent)) {
    if (!isFn(WIP.type)) return WIP.node
  }
}

/**
 * @desc chid element
 * @param WIP 
 * @returns 
 */
export const getKid = (WIP: IFiber) => {
  while ((WIP = WIP.child)) {
    if (!isFn(WIP.type)) return WIP
  }
}

const diffKids = (WIP: any, children: FreNode): void => {
  let aCh = WIP.kids || [],
    bCh = (WIP.kids = arrayfy(children) as any),
    aHead = 0,
    bHead = 0,
    aTail = aCh.length - 1,
    bTail = bCh.length - 1,
    keyed = null

  while (aHead <= aTail && bHead <= bTail) {
    if (!same(aCh[aTail], bCh[bTail])) break
    clone(aCh[aTail--], bCh[bTail], LANE.UPDATE, WIP, bTail--)
  }

  while (aHead <= aTail && bHead <= bTail) {
    if (!same(aCh[aHead], bCh[bHead])) break
    aHead++; bHead++
  }

  if (aHead > aTail) {
    while (bHead <= bTail) {
      let c = bCh[bTail]
      c.lane = LANE.INSERT
      linke(c, WIP, bTail--)
    }
  } else if (bHead > bTail) {
    while (aHead <= aTail) {
      let c = aCh[aTail--]
      c.lane = LANE.REMOVE
      detach.d = c
      detach = c
    }
  } else {
    if (!keyed) {
      keyed = {}
      for (let i = aHead; i <= aTail; i++) {
        let k = aCh[i].key || '.' + i
        if (k) keyed[k] = i
      }
    }
    while (bHead <= bTail) {
      let c = bCh[bTail]
      let idx = keyed[c.key]
      if (idx != null && same(c, aCh[idx])) {
        clone(aCh[idx], c, LANE.INSERT, WIP, bTail--)
        delete keyed[c.key]
      } else {
        c.lane = LANE.INSERT
        linke(c, WIP, bTail--)
      }
    }

    for (const k in keyed) {
      let c = aCh[keyed[k]]
      c.lane = LANE.REMOVE
      detach.d = c
      detach = c
    }
  }

  while (bHead-- > 0) {
    clone(aCh[bHead], bCh[bHead], LANE.UPDATE, WIP, bHead)
  }
}

function linke(kid, WIP, i) {
  kid.parent = WIP
  if (i === WIP.kids.length - 1) {
    if (WIP.lane & LANE.SVG) {
      kid.lane |= LANE.SVG
    }
    WIP.child = kid
  } else {
    WIP._prev.sibling = kid
  }
  WIP._prev = kid
}

function clone(a, b, lane, WIP, i) {
  b.oldProps = a.props
  b.node = a.node
  b.kids = a.kids
  b.hooks = a.hooks
  b.ref = a.ref
  b.lane = lane
  linke(b, WIP, i)
}

function invokeHooks(fiber) {
  const { hooks } = fiber
  if (hooks) {
    side(hooks.layout)
    startTransition(() => side(hooks.effect))
  }
}

const same = (a, b) => {
  return a && b && a.key === b.key && a.type === b.type
}

export const arrayfy = (arr) => (!arr ? [] : isArr(arr) ? arr : [arr])

const side = (effects: IEffect[]): void => {
  effects.forEach((e) => e[2] && e[2]())
  effects.forEach((e) => (e[2] = e[0]()))
  effects.length = 0
}

export const getCurrentFiber = () => currentFiber || null
export const isFn = (x: any): x is Function => typeof x === "function"
export const isStr = (s: any): s is number | string =>
  typeof s === "number" || typeof s === "string"