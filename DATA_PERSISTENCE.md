# 💾 Data Persistence Guide

## ✅ Auto-Save is Now Enabled!

All your changes are now **automatically saved** to your browser's local storage. This means:

- ✅ Your settings persist after page refresh
- ✅ Your settings persist after closing the browser
- ✅ Your settings persist after restarting your computer
- ✅ No need to manually save - it's automatic!

---

## 📦 What's Being Saved

### 1. **Agent Setup** (`agent-identity`, `agent-behavior`, `agent-knowledge`)
- Agent name and company
- Voice settings (voice selection, rate, pitch)
- Greeting and farewell messages
- Business hours and contact info
- FAQs
- Personality settings

### 2. **Automation** (`automation-rules`, `automation-workflows`)
- All automation rules
- Rule priorities and enabled/disabled status
- Workflow configurations
- Workflow status (active/paused)

### 3. **Settings** (`settings-general`, `settings-telephony`, `settings-ai`, `settings-team`)
- General settings (timezone, date format)
- Notification preferences
- Telephony provider configuration
- AI model settings
- Team member list

### 4. **Integrations** (`integrations-config`)
- Voice provider selection (ElevenLabs/Cartesia)
- API keys for all services
- Service configurations
- Enabled/disabled services

---

## 🎯 How It Works

### Automatic Saving
Every time you make a change, it's **automatically saved** to your browser's local storage:

```typescript
// Example from SetupForm.tsx
const [identity, setIdentity] = useLocalStorage('agent-identity', {
  agentName: 'Aria',
  companyName: 'TechCorp Solutions',
  // ... other defaults
});

// When you call setIdentity(), it automatically:
// 1. Updates the React state
// 2. Saves to localStorage
// 3. Next time you load the page, it loads from localStorage
```

### Loading on Page Load
When you open the app, it **automatically loads** your saved settings:

```typescript
// On page load:
// 1. Check if data exists in localStorage
// 2. If yes, load it
// 3. If no, use default values
```

---

## 🛠️ Data Management

### Export Backup
Go to **Dashboard** → **Data Management** → **Export Backup**

This creates a JSON file with all your settings:
```json
{
  "agent-identity": {
    "agentName": "Aria",
    "companyName": "TechCorp Solutions",
    ...
  },
  "automation-rules": [...],
  "settings-general": {...},
  ...
}
```

**Use cases:**
- Backup your settings before making changes
- Transfer settings to another computer
- Share configuration with team members

### Reset to Default
Go to **Dashboard** → **Data Management** → **Reset to Default**

This will:
- ❌ Delete all saved settings
- ❌ Reload the page
- ✅ Restore all default values

**Warning:** This cannot be undone! Export a backup first if needed.

### Clear Cache & Reload
Go to **Dashboard** → **Troubleshooting** → **Clear Cache & Reload**

Same as "Reset to Default" but accessible from the troubleshooting section.

---

## 🔍 Viewing Saved Data

### Browser Developer Tools
You can view your saved data in the browser:

1. Press `F12` to open Developer Tools
2. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
3. Expand **Local Storage**
4. Click on your domain (e.g., `localhost:5173`)
5. You'll see all saved keys:
   - `agent-identity`
   - `agent-behavior`
   - `agent-knowledge`
   - `automation-rules`
   - `automation-workflows`
   - `settings-general`
   - `settings-telephony`
   - `settings-ai`
   - `settings-team`
   - `integrations-config`

### Console Commands
Open browser console (`F12` → Console) and run:

```javascript
// View all saved data
console.log(JSON.parse(localStorage.getItem('agent-identity')));

// View all keys
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  console.log(key, JSON.parse(localStorage.getItem(key)));
}

// Clear all data
localStorage.clear();
location.reload();
```

---

## 🔄 Importing Data (Advanced)

Currently, importing is not available through the UI, but you can do it manually:

### Method 1: Browser Console
1. Open your backup JSON file
2. Open browser console (`F12`)
3. Run:
```javascript
const data = {
  "agent-identity": {...},
  "automation-rules": [...],
  // ... paste your backup data
};

Object.entries(data).forEach(([key, value]) => {
  localStorage.setItem(key, JSON.stringify(value));
});

location.reload();
```

### Method 2: Programmatic Import
Create a simple HTML file:
```html
<!DOCTYPE html>
<html>
<body>
  <input type="file" id="fileInput" accept=".json">
  <script>
    document.getElementById('fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = JSON.parse(event.target.result);
        Object.entries(data).forEach(([key, value]) => {
          localStorage.setItem(key, JSON.stringify(value));
        });
        alert('Data imported! Refreshing...');
        location.reload();
      };
      reader.readAsText(file);
    });
  </script>
</body>
</html>
```

---

## 🌐 Browser Storage Limits

### Local Storage Limits
- **Chrome**: ~5-10 MB
- **Firefox**: ~5-10 MB
- **Safari**: ~5 MB
- **Edge**: ~5-10 MB

### Your Data Size
Typical usage:
- Agent config: ~1-2 KB
- Automation rules: ~2-5 KB
- Settings: ~3-5 KB
- Integrations: ~2-3 KB
- **Total**: ~10-15 KB (well within limits!)

### What If Storage is Full?
If localStorage is full:
1. You'll see a console error
2. New changes won't save
3. Export your data and clear old data

---

## 🔒 Privacy & Security

### Where is Data Stored?
- **Location**: Your browser's local storage
- **Scope**: Only accessible from your domain (e.g., `localhost:5173`)
- **Persistence**: Until you clear it or uninstall the browser

### Is Data Secure?
- ✅ Not sent to any server
- ✅ Not accessible by other websites
- ✅ Only stored in your browser
- ❌ Not encrypted (plain text in browser)
- ❌ Cleared if you clear browser data

### Multi-Device Sync
**Current limitation**: Data is stored per-browser, per-device.

To sync across devices:
1. Export backup from Device A
2. Import backup to Device B (manual process)
3. Or use the Python backend with a database (future feature)

---

## 🐛 Troubleshooting

### "My settings aren't saving!"

**Check 1: Browser Support**
```javascript
// Open console and run:
console.log('localStorage available:', typeof localStorage !== 'undefined');
```

**Check 2: Storage Quota**
```javascript
// Check used space
let total = 0;
for (let key in localStorage) {
  if (localStorage.hasOwnProperty(key)) {
    total += localStorage[key].length + key.length;
  }
}
console.log('Used:', (total / 1024).toFixed(2), 'KB');
```

**Check 3: Private/Incognito Mode**
- Some browsers disable localStorage in private mode
- Try regular browsing mode

**Check 4: Browser Extensions**
- Privacy extensions may block localStorage
- Try disabling extensions temporarily

### "I lost my settings!"

**Possible causes:**
1. Cleared browser data
2. Used incognito/private mode
3. Different browser or device
4. localStorage was full and new data couldn't save

**Recovery:**
- If you exported a backup, import it (see Importing Data section)
- Otherwise, settings are lost and defaults will be used

### "Settings persist but shouldn't!"

**To clear all data:**
1. Go to Dashboard → Data Management → Reset to Default
2. Or: Dashboard → Troubleshooting → Clear Cache & Reload
3. Or: Browser console → `localStorage.clear(); location.reload();`

---

## 📊 Storage Keys Reference

| Key | Component | Description |
|-----|-----------|-------------|
| `agent-identity` | SetupForm | Agent name, company, voice settings |
| `agent-behavior` | SetupForm | Greeting, farewell, personality |
| `agent-knowledge` | SetupForm | Business hours, FAQs, contact info |
| `automation-rules` | Automation | Call routing rules |
| `automation-workflows` | Automation | Automated workflows |
| `settings-general` | Settings | General app settings |
| `settings-telephony` | Settings | Phone provider config |
| `settings-ai` | Settings | AI model settings |
| `settings-team` | Settings | Team members |
| `integrations-config` | Integrations | All service integrations |

---

## 🎯 Best Practices

### 1. **Export Regularly**
- Export backup before making major changes
- Keep backups in a safe location
- Export before clearing browser data

### 2. **Test Changes**
- Make changes in small increments
- Test after each change
- Export before testing risky changes

### 3. **Document Your Settings**
- Keep notes on important configurations
- Document why you chose specific settings
- Track changes over time

### 4. **Use Version Control**
- Export backups with dates: `backup-2024-01-15.json`
- Keep multiple versions
- Compare different configurations

### 5. **Team Collaboration**
- Export your configuration
- Share with team members
- They can import and customize

---

## 🚀 Future Enhancements

### Planned Features
- [ ] Import from UI (currently manual only)
- [ ] Cloud sync with backend
- [ ] Multi-user support
- [ ] Configuration versioning
- [ ] Diff/compare configurations
- [ ] Template library
- [ ] Share configurations via URL

### Backend Integration
When you connect the Python backend:
- Settings will sync to database
- Multi-device support
- Team collaboration
- Configuration history
- Rollback to previous versions

---

## 📞 Support

### Common Questions

**Q: Will my data be deleted if I update the app?**
A: No, localStorage persists across updates.

**Q: Can I use this on multiple computers?**
A: Yes, but data is per-browser. Export/import to sync.

**Q: Is my data secure?**
A: Yes, it's only in your browser. Not sent anywhere.

**Q: What happens if I clear my browser data?**
A: All settings will be lost. Export a backup first!

**Q: Can I share my configuration?**
A: Yes, export as JSON and share the file.

### Need Help?
1. Check the Diagnostic Tool on Dashboard
2. Review TROUBLESHOOTING.md
3. Check browser console for errors
4. Export your data and share for analysis

---

## 🎉 Summary

✅ **Auto-save is enabled** - All changes persist automatically
✅ **No manual save needed** - It just works!
✅ **Export/Import available** - Backup and restore your data
✅ **Reset option** - Start fresh if needed
✅ **Secure** - Data stays in your browser
✅ **Reliable** - Uses standard browser APIs

**Your settings are now persistent!** 🎊
