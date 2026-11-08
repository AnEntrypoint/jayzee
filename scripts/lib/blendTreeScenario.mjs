const attempt = (fn) => {
  try {
    return { ok: fn() ?? null }
  } catch (error) {
    return { threw: error.message }
  }
}

const run = (lines, label, fn) => {
  lines.push(JSON.stringify({ label, result: attempt(fn) }))
}

const oneD = (BlendTree1D) => {
  const lines = []
  const tree = new BlendTree1D(['idle', { clip: 'walk', threshold: 1 }, { clip: 'run', threshold: 4 }, { clip: 'sprint', threshold: 8 }])
  for (const p of [-1, 0, 0.5, 1, 2.5, 4, 6, 8, 9]) {
    run(lines, '1D parameter ' + p + ' weights', () => {
      tree.setParameter(p)
      return [tree.getWeights(), tree.getWeight(1), tree.getWeight(9)]
    })
  }
  run(lines, '1D clips after construction', () => tree.clips)
  run(lines, '1D empty tree', () => new BlendTree1D().setParameter(5).getWeights())
  run(lines, '1D addClip chains and weights', () => new BlendTree1D().addClip('a', 0).addClip('b', 10).setParameter(5).getWeights())
  run(lines, '1D duplicate thresholds take the high index', () => new BlendTree1D([{ clip: 'a', threshold: 0 }, { clip: 'b', threshold: 0 }]).setParameter(0).getWeights())
  run(lines, '1D bare object is a clip with threshold 0', () => new BlendTree1D([{ name: 'bare' }]).clips)
  run(lines, '1D getWeights returns a copy', () => {
    const t = new BlendTree1D(['a', 'b'])
    t.setParameter(0.5)
    const w = t.getWeights()
    w[0] = 99
    return [w, t.getWeights()]
  })
  run(lines, '1D null entry is refused', () => new BlendTree1D([null]))
  run(lines, '1D entry without a clip is refused', () => new BlendTree1D([{ threshold: 1 }]))
  run(lines, '1D addClip with null clip is refused', () => new BlendTree1D().addClip(null, 0))
  run(lines, '1D entry with null clip is refused', () => new BlendTree1D([{ clip: 'a' }, { clip: null }]))
  return lines
}

const twoD = (BlendTree2D) => {
  const lines = []
  const tree = new BlendTree2D([
    { clip: 'idle', x: 0, y: 0 },
    { clip: 'north', x: 0, y: 1 },
    { clip: 'east', x: 1, y: 0 },
    { clip: 'north-east', x: 1, y: 1 },
  ])
  for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5], [0.25, 0.1], [10, 10], [0.001, 0], [0.004, 0.003], [-0.5, 0.5], [0.5, 0]]) {
    run(lines, '2D (' + x + ', ' + y + ') weights', () => {
      tree.setParameter(x, y)
      return [tree.getWeights(), tree.getWeight(0), tree.getWeight(7)]
    })
  }
  run(lines, '2D clips after construction', () => tree.clips)
  run(lines, '2D empty tree', () => new BlendTree2D().setParameter(0, 0).getWeights())
  run(lines, '2D addClip defaults to the origin', () => new BlendTree2D().addClip('a').addClip('b', 3).setParameter(3, 0).getWeights())
  run(lines, '2D two samples use both', () => new BlendTree2D([{ clip: 'a', x: 0, y: 0 }, { clip: 'b', x: 2, y: 0 }]).setParameter(0.5, 0).getWeights())
  const line = new BlendTree2D([{ clip: 'a', x: 0, y: 0 }, { clip: 'b', x: 1, y: 0 }, { clip: 'c', x: 2, y: 0 }, { clip: 'd', x: 3, y: 0 }, { clip: 'e', x: 4, y: 0 }])
  run(lines, '2D nearest three of five on a line', () => line.setParameter(1.4, 0).getWeights())
  run(lines, '2D equal distances keep the listed order', () => tree.setParameter(0.5, 0).getWeights())
  run(lines, '2D null entry is refused', () => new BlendTree2D([null]))
  run(lines, '2D entry without a clip is refused', () => new BlendTree2D([{ x: 0, y: 0 }]))
  run(lines, '2D addClip with null clip is refused', () => new BlendTree2D().addClip(null, 0, 0))
  return lines
}

const node = (BlendTreeNode) => {
  const lines = []
  const calls = []
  const child = (name) => ({ update: (dt) => calls.push(name + ' ' + dt) })
  const parent = new BlendTreeNode('root')
  run(lines, 'node initial state', () => ({ name: parent.name, children: parent.children.length, output: parent.output }))
  run(lines, 'addChild returns the node', () => parent.addChild(child('a')) === parent)
  run(lines, 'addChild chains and accepts a child without update', () => parent.addChild({ name: 'plain' }).addChild(child('b')).children.length)
  run(lines, 'update forwards dt to children with update only', () => {
    parent.update(0.5)
    return calls.splice(0)
  })
  run(lines, 'default name and children', () => {
    const n = new BlendTreeNode()
    return [n.name, n.children, n.output]
  })
  run(lines, 'children array is shared with the argument', () => {
    const list = []
    new BlendTreeNode('x', list).addChild(child('c'))
    return list.length
  })
  return lines
}

export const runBlendTree = (lib) => ({
  BlendTree1D: oneD(lib.BlendTree1D),
  BlendTree2D: twoD(lib.BlendTree2D),
  BlendTreeNode: node(lib.BlendTreeNode),
})
