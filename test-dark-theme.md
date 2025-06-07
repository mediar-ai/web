# Dark Theme Toggle - Manual Test Checklist

## Prerequisites
- [ ] Run `npm run dev` to start the development server
- [ ] Open http://localhost:3000 in your browser

## Test Cases

### 1. Theme Toggle Button Visibility
- [ ] Verify a sun/moon icon button appears in the page header
- [ ] Button should be positioned next to the user dropdown

### 2. Theme Switching
- [ ] Click the theme toggle button
- [ ] Verify dropdown menu appears with three options: Light, Dark, System
- [ ] Select "Dark" - verify page switches to dark theme
- [ ] Select "Light" - verify page switches to light theme
- [ ] Select "System" - verify theme matches your OS preference

### 3. Theme Persistence
- [ ] Set theme to "Dark"
- [ ] Refresh the page (F5)
- [ ] Verify dark theme is still active
- [ ] Repeat test with "Light" theme

### 4. Visual Verification
- [ ] In dark mode, verify:
  - Background is dark
  - Text is light/white
  - UI elements have appropriate dark theme colors
  - No visual glitches or contrast issues

### 5. System Preference
- [ ] Set theme to "System"
- [ ] Change your OS dark mode setting
- [ ] Verify the app theme updates accordingly

## Expected Results
✅ All theme options work correctly
✅ Theme persists across page reloads
✅ Visual elements adapt properly to each theme
✅ No console errors related to theme switching