# Paginated funding observer

This read-only observer uses the same bounded coordinator history client as the worker. It rejects ingress update endpoints and validates the public canister, gateway and artifact bindings before returning observations.

The host fingerprint is deliberately a `CONFIGURE_HOST_ID` placeholder. This reference is not a runnable production funding installation. Private financial configuration, credentials, process ownership receipts and host-specific controls are not included. The production repair retained the existing funding policy and adopted its new primary process witness; no funding settings were changed.

Run its isolated transport/validation tests from the inference root with:

```sh
node --test server/autorefill/observer.test.mjs
```
