// Vendored from @open-spaced-repetition/binding-wasm32-wasi@0.4.0
// because the upstream package incorrectly declares `cpu: wasm32` and
// fails to install on x64 VMs. Keep this in sync when updating the binding.

import { instantiateNapiModuleSync, MessageHandler, WASI } from '@napi-rs/wasm-runtime'

const errorOutputs = []

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    const wasi = new WASI({
      print: function () {
        // Intentionally no-op: WASM stdout is debug noise that should not leak
        // into production system logs.
      },
      printErr: function() {
        // eslint-disable-next-line no-console
        console.error.apply(console, arguments)
        errorOutputs.push([...arguments])
      },
    })
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        }
      },
    })
  },
  onError(error) {
    postMessage({ type: 'error', error, errorOutputs })
    errorOutputs.length = 0
  },
})

globalThis.onmessage = function (e) {
  handler.handle(e)
}
