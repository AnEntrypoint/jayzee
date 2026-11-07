## ObjectSpec (full)

```ts
ObjectSpec = {
  id?: str, tags?: [str, ...], state?: Record<str, any>, behavior?: "scripts/file.js" | [...],
  parent?: str, children?: ObjectSpec[], ...ObjectPropertiesSpec ,
  place?: str, audience?: "near" | "all" | "local", visibility?: "owner" | "platform", lifetime?: num, tick?: { phase?: "pre" | "post", order? },
}
```
