# Troubleshooting Guide - Functions Not Working

## Common Issues and Solutions

### 1. **Toggle Buttons Not Responding**

**Issue**: Toggle buttons click but don't change state visually

**Solution**: 
- Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
- Check browser console for errors (F12)
- Verify JavaScript is enabled

**Debug Steps**:
```javascript
// Open browser console and run:
console.log('Testing toggle functionality');
```

---

### 2. **Download Button Not Working**

**Issue**: Clicking "Download ZIP" does nothing

**Possible Causes**:
- Browser blocking downloads
- JavaScript error preventing execution
- Missing dependencies

**Solution**:
1. Check browser console (F12) for errors
2. Allow downloads in browser settings
3. Try a different browser (Chrome recommended)
4. Clear browser cache

**Manual Download Alternative**:
If the download button doesn't work, you can manually create the Python backend:
```bash
# Navigate to python-backend folder
cd python-backend

# The files are already there!
# Just follow the setup instructions in README.md
```

---

### 3. **Form Inputs Not Updating**

**Issue**: Typing in input fields doesn't update the value

**Solution**:
- Refresh the page
- Check if there's a JavaScript error in console
- Try clicking outside the input and back in

---

### 4. **Navigation Not Working**

**Issue**: Sidebar buttons don't change pages

**Solution**:
- Refresh the page
- Check browser console for errors
- Try clicking multiple times

---

### 5. **Voice Preview Not Playing**

**Issue**: Clicking play button on voice cards doesn't play audio

**Possible Causes**:
- Browser doesn't support Speech Synthesis API
- No voices available in browser
- Audio permissions blocked

**Solution**:
1. Use Chrome, Edge, or Safari (best support)
2. Check browser audio settings
3. Allow audio playback
4. Try different voice cards

**Test Speech Synthesis**:
```javascript
// Open browser console and run:
const utterance = new SpeechSynthesisUtterance('Hello world');
speechSynthesis.speak(utterance);
```

---

### 6. **Call Simulator Not Responding**

**Issue**: Messages don't send or agent doesn't respond

**Solution**:
- Check if call status is "active" (not "ended")
- Refresh the page
- Check browser console for errors

---

### 7. **Settings Not Saving**

**Issue**: Changes don't persist after clicking "Save"

**Note**: This is expected behavior in the demo version. The UI shows the save animation, but data isn't actually persisted to a backend. This is a frontend-only demo.

**For Production**: 
- Connect to the Python backend
- Implement proper API calls
- Use database storage

---

## Diagnostic Checklist

Run through this checklist to identify issues:

### Browser Check
- [ ] Using Chrome, Edge, or Safari (recommended)
- [ ] JavaScript is enabled
- [ ] No browser extensions blocking functionality
- [ ] Browser is up to date

### Console Check
- [ ] Open browser console (F12)
- [ ] Check for red error messages
- [ ] Look for warnings
- [ ] Note any error messages

### Network Check
- [ ] Page loads completely
- [ ] No failed network requests
- [ ] All assets load properly

### Functionality Check
- [ ] Sidebar navigation works
- [ ] Toggle buttons respond to clicks
- [ ] Input fields accept text
- [ ] Buttons show hover effects
- [ ] Forms submit properly

---

## Quick Fixes

### Fix 1: Hard Refresh
```
Windows/Linux: Ctrl + Shift + R
Mac: Cmd + Shift + R
```

### Fix 2: Clear Cache
```
Chrome: Settings > Privacy > Clear browsing data
Firefox: Options > Privacy > Clear Data
Safari: Preferences > Privacy > Manage Website Data
```

### Fix 3: Disable Extensions
Temporarily disable browser extensions, especially:
- Ad blockers
- Script blockers
- Privacy extensions

### Fix 4: Try Incognito/Private Mode
Open the app in incognito/private browsing mode to rule out extension conflicts.

---

## Browser Console Errors

### Common Errors and Solutions

**Error**: `Uncaught TypeError: Cannot read property 'map' of undefined`
**Solution**: Data not loaded yet. Refresh the page.

**Error**: `Uncaught ReferenceError: JSZip is not defined`
**Solution**: Dependencies not loaded. Refresh the page or check network tab.

**Error**: `Uncaught TypeError: Cannot read property 'current' of null`
**Solution**: React ref issue. Refresh the page.

**Error**: `SpeechSynthesis not supported`
**Solution**: Use a different browser (Chrome recommended).

---

## Specific Component Issues

### Automation Page
**Issue**: Can't add new rules
**Solution**: Make sure all fields (name, trigger, action) are filled before clicking "Create Rule"

**Issue**: Toggle doesn't work
**Solution**: Refresh page, check console for errors

### Setup Form
**Issue**: Can't switch tabs
**Solution**: Refresh page, check console

**Issue**: Voice preview doesn't play
**Solution**: Use Chrome, check audio permissions

### Settings
**Issue**: Can't switch between sections
**Solution**: Refresh page, check console

**Issue**: Toggle buttons don't work
**Solution**: Refresh page, check console

### Call Simulator
**Issue**: Can't send messages
**Solution**: Make sure call status is "active" (not "ended")

**Issue**: Agent doesn't respond
**Solution**: Wait 1-2 seconds for response, check console

---

## Getting Help

If none of the above solutions work:

1. **Check Browser Console**
   - Press F12
   - Go to "Console" tab
   - Look for red error messages
   - Take a screenshot

2. **Check Network Tab**
   - Press F12
   - Go to "Network" tab
   - Refresh the page
   - Look for failed requests (red)

3. **Browser Information**
   - Browser name and version
   - Operating system
   - Any error messages from console

4. **Steps to Reproduce**
   - What were you trying to do?
   - What happened instead?
   - Does it happen every time?

---

## Expected Behavior

### What Should Work:
✅ Sidebar navigation between pages
✅ Toggle buttons changing state
✅ Form inputs accepting text
✅ Voice preview playing audio
✅ Call simulator sending/receiving messages
✅ Download button creating ZIP file
✅ All buttons showing hover effects
✅ Smooth animations and transitions

### What's Demo-Only (Not Persisted):
⚠️ Settings changes (UI only, no backend)
⚠️ Agent configuration (UI only)
⚠️ Automation rules (UI only)
⚠️ Call history (simulated data)

For persistent data, you need to:
1. Set up the Python backend
2. Connect the frontend to the backend API
3. Implement proper database storage

---

## Production Deployment

To make all functions work with real data persistence:

1. **Start Python Backend**
```bash
cd python-backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

2. **Update Frontend API Calls**
Replace mock data with actual API calls to `http://localhost:8000/api/...`

3. **Configure Environment**
Set up `.env` file with your API keys

4. **Test Integration**
Verify frontend can communicate with backend

---

## Contact Support

If you're still experiencing issues after trying all the above:

1. Take screenshots of:
   - The problem
   - Browser console errors
   - Network tab (if relevant)

2. Provide:
   - Browser name and version
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior

3. Check:
   - GitHub Issues (if applicable)
   - Documentation
   - Community forums

---

## Quick Test Script

Open browser console and run this to test basic functionality:

```javascript
// Test 1: Check if React is loaded
console.log('React loaded:', typeof React !== 'undefined');

// Test 2: Check if JSZip is loaded
console.log('JSZip loaded:', typeof JSZip !== 'undefined');

// Test 3: Test speech synthesis
const testSpeech = () => {
  const utterance = new SpeechSynthesisUtterance('Test');
  speechSynthesis.speak(utterance);
  console.log('Speech synthesis working');
};
testSpeech();

// Test 4: Check all buttons are clickable
document.querySelectorAll('button').forEach(btn => {
  btn.style.border = '2px solid red';
  setTimeout(() => btn.style.border = '', 2000);
});
console.log('All buttons highlighted for 2 seconds');
```

This will help identify if core functionality is working.
