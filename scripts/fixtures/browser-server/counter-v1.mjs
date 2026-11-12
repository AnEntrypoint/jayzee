export default {
  server: {
    setup: (ctx) => { ctx.state.count ??= 0 },
    update: (ctx) => {
      ctx.state.count += 1
      ctx.entity.custom = { count: ctx.state.count, version: 1 }
    },
  },
}
