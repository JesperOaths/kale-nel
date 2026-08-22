# v813 finalization guardrails

This temporary release-hardening note records two certification contracts that must remain aligned with production behavior:

- browser certification player sessions use the real 48-character lowercase hexadecimal token shape accepted by `gejast-config.js`;
- visual data-plane probing may retry at most three times with bounded per-attempt timeout and delay.

These guards exist to prevent test-fixture defects from being misclassified as product failures during the final v813 release campaign.
