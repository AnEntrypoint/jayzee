import { blendWeights1D, blendWeights2D } from './blend.js'

const isEntry = (value) => typeof value === 'object' && value !== null && 'clip' in value

function entry1D(element, index) {
  if (isEntry(element)) {
    if (element.clip === null || element.clip === undefined) {
      throw new Error('[BlendTree1D] clips[' + index + '] names no clip')
    }
    return { clip: element.clip, threshold: element.threshold ?? 0 }
  }
  if (element === null || element === undefined) {
    throw new Error('[BlendTree1D] clips[' + index + '] is ' + element + '; pass a clip or build the tree with addClip(clip, threshold)')
  }
  return { clip: element, threshold: 0 }
}

function entry2D(element, index) {
  if (isEntry(element)) {
    if (element.clip === null || element.clip === undefined) {
      throw new Error('[BlendTree2D] clips[' + index + '] names no clip')
    }
    return { clip: element.clip, x: element.x ?? 0, y: element.y ?? 0 }
  }
  if (element === null || element === undefined) {
    throw new Error('[BlendTree2D] clips[' + index + '] is ' + element + '; pass a clip or build the tree with addClip(clip, x, y)')
  }
  return { clip: element, x: 0, y: 0 }
}

export class BlendTree1D {
  constructor(clips = []) {
    this.clips = clips.map(entry1D)
    this.weights = new Array(this.clips.length).fill(0)
    this.parameter = 0
  }

  addClip(clip, threshold = 0) {
    this.clips.push(entry1D({ clip, threshold }, this.clips.length))
    this.weights.push(0)
    return this
  }

  setParameter(value) {
    this.parameter = value
    this._updateWeights()
    return this
  }

  _updateWeights() {
    if (this.clips.length === 0) return
    this.weights = blendWeights1D(this.clips.map((clip) => clip.threshold), this.parameter)
  }

  getWeight(index) {
    return this.weights[index] || 0
  }

  getWeights() {
    return [...this.weights]
  }
}

export class BlendTree2D {
  constructor(clips = []) {
    this.clips = clips.map(entry2D)
    this.weights = new Array(this.clips.length).fill(0)
    this.posX = 0
    this.posY = 0
  }

  addClip(clip, x = 0, y = 0) {
    this.clips.push(entry2D({ clip, x, y }, this.clips.length))
    this.weights.push(0)
    return this
  }

  setParameter(x, y) {
    this.posX = x
    this.posY = y
    this._updateWeights()
    return this
  }

  _updateWeights() {
    if (this.clips.length === 0) return
    this.weights = blendWeights2D(this.clips, this.posX, this.posY)
  }

  getWeight(index) {
    return this.weights[index] || 0
  }

  getWeights() {
    return [...this.weights]
  }
}

export class BlendTreeNode {
  constructor(name = '', children = []) {
    this.name = name
    this.children = children
    this.output = 0
  }

  addChild(node) {
    this.children.push(node)
    return this
  }

  update(dt) {
    for (const child of this.children) {
      if (typeof child.update === 'function') {
        child.update(dt)
      }
    }
  }
}

export default { BlendTree1D, BlendTree2D, BlendTreeNode }
