const modeSelect = document.getElementById('modeSelect');
const delayRow = document.getElementById('delayRow');
const clockRow = document.getElementById('clockRow');
const timeInput = document.getElementById('timeInput');
const statusDiv = document.getElementById('status');

modeSelect.addEventListener('change', () => {
    const clock = modeSelect.value === 'clock';
    delayRow.hidden = clock;
    clockRow.hidden = !clock;
});

function showStatus(text, isError) {
    statusDiv.innerText = text;
    statusDiv.classList.toggle('err', !!isError);
}

document.getElementById('runBtn').addEventListener('click', async () => {
    const message = document.getElementById('messageInput').value.trim();
    if (!message) return showStatus('יש להזין תוכן להודעה.', true);

    let alarmInfo, label, due;
    if (modeSelect.value === 'clock') {
        if (!timeInput.value) return showStatus('יש לבחור שעה.', true);
        const [h, m] = timeInput.value.split(':').map(Number);
        const target = new Date();
        target.setHours(h, m, 0, 0);
        // אם השעה כבר עברה (או קרובה מדי), מתזמנים למחר
        if (target.getTime() - Date.now() < 30000) target.setDate(target.getDate() + 1);
        alarmInfo = { when: target.getTime() };
        due = target.getTime();
        const isTomorrow = target.getDate() !== new Date().getDate();
        label = `ההודעה תישלח ${isTomorrow ? 'מחר ' : ''}בשעה ${timeInput.value}.`;
    } else {
        const minutes = Math.max(0.5, parseFloat(document.getElementById('minutesInput').value) || 1);
        alarmInfo = { delayInMinutes: minutes };
        due = Date.now() + minutes * 60000;
        label = `התזמון הוגדר בהצלחה לעוד ${minutes} דקות.`;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showStatus('לא נמצא טאב פעיל.', true);

    const alarmName = `sendTask_${tab.id}`;
    await chrome.storage.local.set({ [alarmName]: { message, tabId: tab.id, url: tab.url, due } });
    await chrome.alarms.create(alarmName, alarmInfo);

    showStatus(label, false);
    setTimeout(() => window.close(), 1800);
});
