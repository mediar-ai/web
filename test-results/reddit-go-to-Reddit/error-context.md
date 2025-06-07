# Test info

- Name: go to Reddit
- Location: /Users/matthewdi/Desktop/screenpipe/browser-workflow-capture-app/reddit.spec.ts:3:5

# Error details

```
Error: Timed out 5000ms waiting for expect(locator).toHaveTitle(expected)

Locator: locator(':root')
Expected pattern: /Reddit/
Received string:  ""
Call log:
  - expect.toHaveTitle with timeout 5000ms
  - waiting for locator(':root')
    9 × locator resolved to <html>…</html>
      - unexpected value ""

    at /Users/matthewdi/Desktop/screenpipe/browser-workflow-capture-app/reddit.spec.ts:7:22
```

# Page snapshot

```yaml
- img
- text: You've been blocked by network security. If you think you've been blocked by mistake, file a ticket below and we'll look into it.
- link "File a ticket":
  - /url: https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=21879292693140
```

# Test source

```ts
  1 | import { test, expect } from '@playwright/test';
  2 |
  3 | test('go to Reddit', async ({ page }) => {
  4 |   await page.goto('https://www.reddit.com/');
  5 |   await page.waitForLoadState('networkidle');
  6 |   // We can add an assertion to make sure we are on the right page
> 7 |   await expect(page).toHaveTitle(/Reddit/);
    |                      ^ Error: Timed out 5000ms waiting for expect(locator).toHaveTitle(expected)
  8 | }); 
```