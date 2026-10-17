const running = new Set();

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith("sendTask_")) runTask(alarm.name);
});

// משימות שהזמן שלהן עבר בזמן שהדפדפן היה סגור או המחשב ישן
async function runOverdue() {
    const all = await chrome.storage.local.get(null);
    for (const [key, task] of Object.entries(all)) {
        if (key.startsWith("sendTask_") && task && task.due && task.due <= Date.now()) {
            runTask(key);
        }
    }
}
chrome.runtime.onStartup.addListener(runOverdue);
chrome.runtime.onInstalled.addListener(runOverdue);

async function runTask(name) {
    if (running.has(name)) return;
    running.add(name);
    try {
        const data = await chrome.storage.local.get(name);
        const task = data[name];
        if (!task || !task.message) return;

        // "תפיסת" המשימה כדי למנוע שליחה כפולה
        await chrome.storage.local.remove(name);

        let sent = false;
        try {
            sent = await executeTask(task);
        } catch (error) {
            console.error("שגיאה בביצוע הפעולה:", error);
        }
        if (!sent) {
            // מחזירים את המשימה כדי שלא תאבד
            await chrome.storage.local.set({ [name]: task });
        }
    } finally {
        running.delete(name);
    }
}

async function executeTask(task) {
    let tabId = task.tabId;
    let freshTab = false;

    // 1. בדיקה שהטאב קיים; אם נסגר, פותחים מחדש את הכתובת
    let tab = null;
    try {
        tab = await chrome.tabs.get(tabId);
    } catch (e) {
        if (!task.url || !/^https?:/.test(task.url)) {
            console.error("הטאב נסגר ואין כתובת לפתיחה מחדש:", tabId);
            return true; // אין מה לנסות שוב
        }
        tab = await chrome.tabs.create({ url: task.url, active: false });
        tabId = tab.id;
        freshTab = true;
        console.log("הטאב נסגר, נפתח מחדש:", task.url);
    }

    // 2. טאב שהורדם: טוענים מחדש
    if (tab.discarded) {
        await chrome.tabs.reload(tabId);
        freshTab = true;
    }
    await waitForTabComplete(tabId, freshTab ? 2500 : 1000);

    // 3. הכנסת הטקסט לשדה
    const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: insertText,
        args: [task.message]
    });
    if (!res || !res.result) {
        console.error("לא נמצא שדה טקסט מתאים בדף.");
        return false;
    }

    // 4. שליחה בלחיצת Ctrl+Enter אמיתית
    await trustedCtrlEnter(tabId);
    console.log(`בוצעה שליחה בטאב ${tabId}`);
    return true;
}

function waitForTabComplete(tabId, settleMs = 1000, timeoutMs = 30000) {
    return new Promise(async (resolve) => {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return setTimeout(resolve, settleMs);

        const timer = setTimeout(done, timeoutMs);
        function listener(id, info) {
            if (id === tabId && info.status === "complete") done();
        }
        function done() {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, settleMs);
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

function insertText(textToInsert) {
    const field = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    if (!field) return false;

    field.focus();
    if (field.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(field, textToInsert);
    } else {
        field.textContent = textToInsert;
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

async function trustedCtrlEnter(tabId) {
    const target = { tabId };
    await chrome.debugger.attach(target, "1.3");
    try {
        await chrome.debugger.sendCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: true });
        await new Promise(r => setTimeout(r, 300));
        const base = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 };
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { ...base, type: "keyDown", text: "\r" });
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    } finally {
        await chrome.debugger.detach(target);
    }
}
