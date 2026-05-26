---
name: fe-testing
description: Frontend testing patterns using Playwright — navigation, interaction, assertions, screenshots on failure, and common UI testing scenarios.
activation: Load when testing frontend UI with Playwright
allowed-tools: playwright_browser_navigate, playwright_browser_click, playwright_browser_fill_form, playwright_browser_snapshot, playwright_browser_take_screenshot, playwright_browser_press_key, playwright_browser_select_option, playwright_browser_hover, playwright_browser_wait_for, playwright_browser_evaluate, playwright_browser_console_messages, playwright_browser_navigate_back, playwright_browser_tabs, playwright_browser_handle_dialog, playwright_browser_resize, playwright_browser_close, playwright_browser_drag, playwright_browser_type, playwright_browser_file_upload, playwright_browser_network_requests, Write, Read, Bash(mkdir:*)
---

# Frontend Testing Patterns

## Playwright Strategy

**Priority order:**
1. **OpenCode native Playwright tools** — `playwright_browser_navigate`, `playwright_browser_click`, `playwright_browser_snapshot`, etc.
2. **Bash `playwright` CLI** — `playwright screenshot`, `playwright open`, JS eval via node
3. **None** — mark all FE scenarios as SKIP

---

## Execution Workflow

For each FE scenario from the test plan:

1. **Read the scenario** — understand steps, expected result, edge cases
2. **Execute main flow** — follow steps using available Playwright method
3. **Verify result** — check for expected elements/text
4. **Execute edge cases** — run each edge case as a sub-test
5. **Record result** — pass/fail with details

---

## Bash Playwright CLI Patterns

### Navigation & Verification

**Screenshot for visual verification:**
```bash
playwright screenshot --viewport-size=1280,720 "http://localhost:3000/page" /tmp/page-screenshot.png
```

Inspect the screenshot to verify the page loaded correctly.

**Open page in browser (for interactive debugging):**
```bash
playwright open "http://localhost:3000/page"
```

### JavaScript Evaluation via Node

Create a temporary script to evaluate JS on the page:
```bash
cat > /tmp/eval.js << 'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/page');
  
  // Evaluate JS
  const result = await page.evaluate(() => {
    return {
      title: document.title,
      itemsCount: document.querySelectorAll('.item').length,
      hasError: !!document.querySelector('.error-message')
    };
  });
  
  console.log(JSON.stringify(result));
  await browser.close();
})();
EOF
node /tmp/eval.js
```

### Screenshot on Failure

```bash
mkdir -p docs/testing/reports/screenshots
playwright screenshot --viewport-size=1280,720 "http://localhost:3000/page" docs/testing/reports/screenshots/fe-XX-fail.png
```

---

## OpenCode Native Playwright Patterns

These are the primary testing tools in OpenCode. Use them whenever available.

### Navigation

```
playwright_browser_navigate(url: "http://localhost:3000/page")
```

- Always use full URLs with the base URL from the test plan
- After navigation, take a snapshot to verify the page loaded:

```
playwright_browser_snapshot()
```

**Navigating back:**

```
playwright_browser_navigate_back()
```

- Returns to the previous page in browser history
- Useful for testing back-button behavior and breadcrumb navigation
- After navigating back, take a snapshot to verify the correct page loaded

### Interaction

**Clicking elements:**

```
playwright_browser_click(element: "Submit button", target: "<element-ref>")
playwright_browser_click(element: "Link with text 'Sign In'", target: "<element-ref>")
```

**Filling forms:**

```
playwright_browser_fill_form(fields: [
  { name: "email", type: "textbox", target: "<ref>", value: "test@example.com" },
  { name: "password", type: "textbox", target: "<ref>", value: "TestPass123!" }
])
```

If `playwright_browser_fill_form` doesn't work for a field, fall back to:

```
playwright_browser_click(element: "email input", target: "<ref>")
playwright_browser_type(target: "<ref>", text: "test@example.com")
```

**Selecting options:**

```
playwright_browser_select_option(element: "Country dropdown", target: "<ref>", values: ["PL"])
```

**Keyboard actions:**

```
playwright_browser_press_key(key: "Enter")
playwright_browser_press_key(key: "Escape")
playwright_browser_press_key(key: "Tab")
```

**File uploads:**

```
playwright_browser_file_upload(paths: ["/path/to/file.pdf"])
```

- Provide absolute paths to files on disk
- Triggered on the currently focused file input element
- Use after clicking a file input or drop zone to open the chooser

**Drag and drop:**

```
playwright_browser_drag(startTarget: "<source-ref>", endTarget: "<target-ref>", startElement: "Draggable item", endElement: "Drop zone")
```

- Simulates dragging one element and dropping it onto another
- Useful for testing reorderable lists, Kanban boards, or file drop zones

### Verification

**Primary method — snapshot and inspect:**

```
playwright_browser_snapshot()
```

After taking a snapshot, inspect the returned accessibility tree for:
- Expected text content
- Element visibility (present in tree = visible)
- Element state (disabled, checked, expanded)
- Error messages
- Success notifications

**JavaScript evaluation for complex checks:**

```
playwright_browser_evaluate(function: "() => document.querySelector('.items-list').children.length")
playwright_browser_evaluate(function: "() => document.title")
playwright_browser_evaluate(function: "() => window.location.pathname")
```

### Dialog Handling

**Accept or dismiss dialogs:**

```
playwright_browser_handle_dialog(accept: true)
playwright_browser_handle_dialog(accept: false)
playwright_browser_handle_dialog(accept: true, promptText: "user input")
```

- Use BEFORE the action that triggers the dialog (dialogs block execution)
- `accept: true` clicks OK/Yes; `accept: false` clicks Cancel/No
- For prompt dialogs, provide `promptText` to fill the input field
- Common triggers: `confirm()`, `alert()`, `prompt()`

### Waiting

```
playwright_browser_wait_for(text: "Success", time: 5)
playwright_browser_wait_for(textGone: ".loading-spinner", time: 10)
```

### Screenshots

```
playwright_browser_take_screenshot(type: "png")
```

### Session Cleanup

**Close the browser:**

```
playwright_browser_close()
```

- Closes the current browser page/context
- Call at the end of a test session to release resources
- Always close after taking final screenshots to avoid leaks

---

## Common Scenario Patterns

### Authentication Flow
1. Navigate to login page
2. Fill email + password
3. Click submit
4. Wait for redirect/dashboard
5. Verify user name/avatar visible
6. Edge: wrong password → error message
7. Edge: empty fields → validation errors

### Form Submission
1. Navigate to form page
2. Fill all required fields
3. Submit
4. Wait for success message or redirect
5. Verify data persisted (check list page or detail page)
6. Edge: submit with empty required fields → validation errors visible
7. Edge: submit with invalid data (bad email format) → field-level errors
8. Edge: double-click submit → no duplicate creation

### CRUD Operations
1. **Create:** Fill form → submit → verify new item in list
2. **Read:** Navigate to detail page → verify all fields displayed
3. **Update:** Open edit form → change field → submit → verify change
4. **Delete:** Click delete → confirm dialog → verify item removed from list
5. Edge: delete already deleted → graceful handling
6. Edge: edit with stale data → conflict handling

### Navigation & Routing
1. Click link → verify URL changed
2. Verify breadcrumb/nav state updated
3. Browser back → verify previous page
4. Direct URL access → verify page renders
5. Edge: access protected page without auth → redirect to login

---

## Result Format

For each scenario, return results in this format:

```
### FE-XX: <scenario name>
- **Status:** PASS / FAIL / SKIP
- **Details:** <what was verified / what went wrong>
- **Screenshot:** <path, only if FAIL>
- **Edge cases:**
  - <edge case 1>: PASS / FAIL — <details>
  - <edge case 2>: PASS / FAIL — <details>
```

---

## Error Handling

- If Playwright is unavailable: mark ALL FE scenarios as SKIP with reason "Playwright unavailable"
- If a page doesn't load (timeout): mark scenario as FAIL, take screenshot, note the URL
- If an element is not found: report what elements ARE visible, mark as FAIL
- If the application shows an error page (500, crash): take screenshot, mark as FAIL with error details
