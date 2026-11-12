export default {
  server: {
    update: (ctx) => {
      ctx.state.count += 1
      ctx.entity.custom = { count: ctx.state.count, version: 2 }
    },
  },
}
