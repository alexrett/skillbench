# Responsive evidence schema

Write `.skillbench/responsive-evidence.json` with this stable shape:

```json
{
  "schemaVersion": 1,
  "target": "http://localhost:4173/",
  "ready": false,
  "pageIdentity": {
    "verified": false,
    "url": null,
    "title": null,
    "meaningfulContent": false
  },
  "console": {
    "verified": false,
    "relevantErrors": []
  },
  "viewports": [
    {
      "name": "mobile",
      "width": 390,
      "height": 844,
      "innerWidth": null,
      "scrollWidth": null,
      "horizontalOverflow": null,
      "method": "not-run"
    }
  ],
  "interactions": [],
  "screenshots": [],
  "proxies": [],
  "fixedBlockers": [],
  "remainingRisk": ["Real browser verification was not available"]
}
```

Use `null` for an unmeasured value. Do not turn a static inference into a measured number. `ready` is true only when page identity, console, applicable viewports, a primary interaction, and screenshots were verified in a real rendered browser.
