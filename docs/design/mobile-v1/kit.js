/*
 * Phone kit. `K(p)` returns the helpers for one platform: p = "ios" | "and". A screen calls the same
 * helpers on both platforms and gets each platform's native pattern (see kit.css for the look).
 * window.SCREENS is filled by screens-*.js; index.html renders them.
 */
(function () {
  "use strict";

  // Lucide-style strokes, 24 grid. Only what the screens use.
  const I = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    phoneIn: '<path d="M16 2v6h6M22 2l-6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    phoneOut: '<path d="M22 8V2h-6M16 8l6-6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    phoneOff: '<g transform="rotate(135 12 12)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></g>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    contact: '<path d="M16 2v2M8 2v2"/><rect x="3" y="4" width="18" height="18" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M7 20a5 5 0 0 1 10 0"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    arrowL: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowUR: '<path d="M7 17 17 7M7 7h10v10"/>',
    arrowDR: '<path d="M7 7l10 10M17 7v10H7"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    calCheck: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkC: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xC: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    shieldX: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m14.5 9.5-5 5M9.5 9.5l5 5"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    msgs: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    moreH: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    moreV: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    micOff: '<path d="M2 2l20 20M18.89 13.23A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    keypad: '<circle cx="6" cy="5" r="1.2"/><circle cx="12" cy="5" r="1.2"/><circle cx="18" cy="5" r="1.2"/><circle cx="6" cy="11" r="1.2"/><circle cx="12" cy="11" r="1.2"/><circle cx="18" cy="11" r="1.2"/><circle cx="6" cy="17" r="1.2"/><circle cx="12" cy="17" r="1.2"/><circle cx="18" cy="17" r="1.2"/><circle cx="12" cy="22" r="1.2"/>',
    speaker: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    dollar: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    buoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
    landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>',
    handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    triangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
    filePen: '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.38 15.62a2.12 2.12 0 1 1 3 3L11 24l-4 1 1-4Z"/>',
    hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    face: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    finger: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    listCheck: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M16 14v4M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01"/>',
    fileCheck: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M9 15l2 2 4-4"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    skip: '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"/>',
    note: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    gavel: '<path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
    badge: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
    package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12M3.29 7 12 12l8.71-5"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34M4 6h.01M2.29 9.62A10 10 0 1 0 21.31 8.35M16.24 7.76A6 6 0 1 0 8.23 16.67M12 18h.01M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    files: '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
    split: '<path d="M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3M15 9l6-6"/>',
    creditCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    gauge: '<path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0"/>',
    network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    signal: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
    wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0"/>',
    wifiOff: '<path d="M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    battery: '<rect x="2" y="7" width="18" height="10" rx="2.5"/><rect x="4" y="9" width="12" height="6" rx="1" fill="currentColor" stroke="none"/><path d="M22 11v2"/>',
    headset: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4M2 7h20M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.94a.5.5 0 0 0-.78-.42L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    nav: '<path d="M3 11 22 2l-9 19-2-8z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    zapOff: '',
  };

  function ic(name, size, extra) {
    const s = size || 20;
    return '<svg class="ico" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + ">" + (I[name] || "") + "</svg>";
  }
  const esc = (s) => String(s);

  // Status chip: always a dot plus words (UI-CONSISTENCY §12).
  function chip(tone, text) {
    return '<span class="chip ' + (tone || "") + '"><i></i>' + text + "</span>";
  }
  function av(initials, cls) {
    return '<span class="av ' + (cls || "") + '">' + initials + "</span>";
  }
  // Money in a card: currency sign + cents muted at about half size (§14).
  function money(whole, cents) {
    return '<span class="money"><span class="c">$</span>' + whole + (cents != null ? '<span class="c">.' + cents + "</span>" : "") + "</span>";
  }
  function spark(vals, w, h, opt) {
    const o = opt || {};
    const W = w || 120, H = h || 36, max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    const sx = W / (vals.length - 1), sy = (H - 6) / ((max - min) || 1);
    const pts = vals.map((v, i) => [i * sx, H - 3 - (v - min) * sy]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const col = o.gold ? "var(--gold)" : "var(--green)";
    const area = d + " L" + W + " " + H + " L0 " + H + "Z";
    const last = pts[pts.length - 1];
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" style="display:block;overflow:visible">' +
      (o.area === false ? "" : '<path d="' + area + '" fill="' + col + '" opacity=".12"/>') +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="' + col + '"/></svg>';
  }
  // Two-series line chart with a faint grid and axis labels drawn from one scale.
  function lines(a, b, labels, W, H) {
    W = W || 330; H = H || 140;
    const padL = 30, padB = 20, padT = 8, iw = W - padL - 6, ih = H - padB - padT;
    const max = Math.ceil(Math.max.apply(null, a.concat(b || [])) / 10) * 10;
    const x = (i, n) => padL + (i * iw) / (n - 1);
    const y = (v) => padT + ih - (v / max) * ih;
    const path = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(i, arr.length).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    let g = "";
    [0, max / 2, max].forEach((t) => {
      g += '<line x1="' + padL + '" x2="' + (W - 6) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (padL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)" font-family="Inter">' + t + "</text>";
    });
    (labels || []).forEach((l, i) => {
      if (!l) return;
      g += '<text x="' + x(i, labels.length) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="Inter">' + l + "</text>";
    });
    const la = a[a.length - 1];
    return '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" style="display:block">' + g +
      '<path d="' + path(a) + " L" + x(a.length - 1, a.length) + " " + y(0) + " L" + padL + " " + y(0) + 'Z" fill="var(--green)" opacity=".1"/>' +
      (b ? '<path d="' + path(b) + '" fill="none" stroke="var(--gold)" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round"/>' : "") +
      '<path d="' + path(a) + '" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(a.length - 1, a.length) + '" cy="' + y(la) + '" r="3.5" fill="var(--green)"/></svg>';
  }
  function bars(vals, labels, W, H, hi) {
    W = W || 330; H = H || 120;
    const padB = labels ? 18 : 2, ih = H - padB - 4, n = vals.length, gap = 6;
    const bw = (W - gap * (n - 1)) / n, max = Math.max.apply(null, vals) || 1;
    let s = "";
    vals.forEach((v, i) => {
      const h = Math.max(2, (v / max) * ih), xx = i * (bw + gap);
      s += '<rect x="' + xx.toFixed(1) + '" y="' + (4 + ih - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + (i === hi ? "var(--green)" : "var(--green)") + '" opacity="' + (i === hi ? 1 : 0.38) + '"/>';
      if (labels && labels[i]) s += '<text x="' + (xx + bw / 2).toFixed(1) + '" y="' + (H - 3) + '" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="Inter">' + labels[i] + "</text>";
    });
    return '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" style="display:block">' + s + "</svg>";
  }
  function ring(pct, size, label, gold) {
    const S = size || 76, r = S / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return '<div class="ring" style="width:' + S + "px;height:" + S + 'px"><svg width="' + S + '" height="' + S + '"><circle cx="' + S / 2 + '" cy="' + S / 2 + '" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="7"/>' +
      '<circle cx="' + S / 2 + '" cy="' + S / 2 + '" r="' + r + '" fill="none" stroke="' + (gold ? "var(--gold)" : "var(--green)") + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + S / 2 + " " + S / 2 + ')"/></svg><b>' + (label || pct + "%") + "</b></div>";
  }

  // ── Role tab bars ──────────────────────────────────────────────────
  const TABS = {
    producer: [["home", "Home", "home"], ["calls", "Calls", "phone"], ["leads", "Leads", "contact"], ["inbox", "Inbox", "inbox"], ["menu", "Menu", "grid"]],
    owner: [["home", "Home", "home"], ["team", "Team", "users"], ["money", "Money", "wallet"], ["inbox", "Inbox", "inbox"], ["menu", "Menu", "grid"]],
    setter: [["home", "Home", "home"], ["calls", "Dialer", "phoneOut"], ["callbacks", "Callbacks", "calCheck"], ["inbox", "Inbox", "inbox"], ["menu", "Menu", "grid"]],
    bookkeeper: [["home", "Home", "home"], ["money", "Money", "wallet"], ["book", "Book", "book"], ["inbox", "Inbox", "inbox"], ["menu", "Menu", "grid"]],
    retention: [["home", "Home", "home"], ["cases", "Cases", "buoy"], ["book", "Book", "book"], ["inbox", "Inbox", "inbox"], ["menu", "Menu", "grid"]],
    partner: [["home", "Home", "home"], ["submit", "Send a lead", "send"], ["pipeline", "Pipeline", "kanban"], ["messages", "Messages", "msgs"], ["account", "Account", "user"]],
  };

  function K(p) {
    const ios = p === "ios";
    const k = { p, ios, ic, chip, av, money, spark, lines, bars, ring };

    k.status = function (o) {
      o = o || {};
      const time = o.time || "9:41";
      const right = ios
        ? ic("signal", 18) + (o.offline ? ic("wifiOff", 18) : ic("wifi", 18)) + ic("battery", 26)
        : (o.offline ? ic("wifiOff", 15) : ic("wifi", 15)) + ic("signal", 15) + ic("battery", 20);
      return '<div class="sb" style="' + (o.light ? "color:#fff" : "") + '"><span class="tn">' + time + '</span><span class="ic">' + right + "</span></div>" + (ios ? '<div class="island"></div>' : '<div class="punch"></div>');
    };

    // Header. o: {title, back, large(default true unless back), actions:[icon...], sub, below, center, menu, blur}
    k.header = function (o) {
      o = o || {};
      const large = o.large !== undefined ? o.large : !o.back;
      if (ios) {
        const left = o.back ? '<span class="back">' + ic("chevL", 26) + esc(o.back) + "</span>" : (o.left || "");
        const right = (o.actions || []).map((a) => (a.charAt(0) === "<" ? a : ic(a, 24))).join("");
        let h = '<div class="hdr' + (o.blur ? " blur" : "") + '"><div class="nav"><div class="l">' + left + "</div>" +
          (!large && o.title ? '<div class="ct">' + o.title + "</div>" : "") + '<div class="r">' + right + "</div></div>";
        if (large && o.title) h += '<div class="ltitle">' + o.title + "</div>";
        if (o.sub) h += '<div class="lsub">' + o.sub + "</div>";
        if (o.below) h += '<div class="below">' + o.below + "</div>";
        if (o.belowFull) h += o.belowFull;
        return h + "</div>";
      }
      const lead = o.back ? '<span class="ib">' + ic("arrowL", 24) + "</span>" : (o.menu ? '<span class="ib">' + ic(o.menu, 24) + "</span>" : '<span style="width:8px"></span>');
      const acts = (o.actions || []).map((a) => '<span class="ib">' + (a.charAt(0) === "<" ? a : ic(a, 24)) + "</span>").join("");
      let h = '<div class="hdr"><div class="mtop">' + lead + '<div class="tt">' + (!large && o.title ? o.title : "") + '</div><div class="acts">' + acts + "</div></div>";
      if (large && o.title) h += '<div class="mtitle">' + o.title + "</div>";
      if (o.sub) h += '<div class="msub">' + o.sub + "</div>";
      if (o.below) h += '<div class="below">' + o.below + "</div>";
      if (o.belowFull) h += o.belowFull;
      return h + "</div>";
    };

    k.tabs = function (role, active, badges) {
      const set = TABS[role || "producer"];
      badges = badges || {};
      return '<div class="tabs-' + (ios ? "ios" : "and") + '">' + set.map(([key, label, icon]) => {
        const b = badges[key] ? '<span class="badge' + (String(badges[key]).charAt(0) === "!" ? " alert" : "") + '">' + String(badges[key]).replace("!", "") + "</span>" : "";
        return '<div class="t' + (key === active ? " on" : "") + '">' + (ios ? ic(icon, 26) + b : '<span class="pill">' + ic(icon, 24) + "</span>" + b) + "<span>" + label + "</span></div>";
      }).join("") + "</div>";
    };

    // iOS segmented control / Android underline tabs.
    k.seg = function (items, on, forceSeg) {
      if (ios || forceSeg) return '<div class="seg">' + items.map((t, i) => '<span class="' + (i === on ? "on" : "") + '">' + t + "</span>").join("") + "</div>";
      return '<div class="utabs">' + items.map((t, i) => '<span class="' + (i === on ? "on" : "") + '">' + t + "</span>").join("") + "</div>";
    };
    k.utabs = function (items, on) {
      return '<div class="utabs">' + items.map((t, i) => '<span class="' + (i === on ? "on" : "") + '">' + t + "</span>").join("") + "</div>";
    };
    k.fchips = function (items) {
      return '<div class="fchips">' + items.map((c) => {
        const o = typeof c === "string" ? { t: c } : c;
        return '<span class="fc' + (o.on ? " on" : "") + '">' + (o.on && !ios ? ic("check", 16) : "") + (o.i ? ic(o.i, 16) : "") + o.t + (o.n != null ? '<span class="n">' + o.n + "</span>" : "") + (o.dd ? ic("chevD", 16) : "") + "</span>";
      }).join("") + "</div>";
    };
    k.search = function (ph) {
      return '<div class="srch">' + ic("search", ios ? 18 : 22) + "<span>" + (ph || "Search") + "</span></div>";
    };

    // List rows. o: {i, it(tone g|w|b|i|plain), av, t, m, r, chip, chev(default true on iOS), cls}
    k.row = function (o) {
      const lead = o.av ? av(o.av) : o.i ? '<span class="lic ' + (o.it || "") + '">' + ic(o.i, ios ? 18 : 20) + "</span>" : o.lead || "";
      const right = (o.chip || "") + (o.r != null ? '<span class="v">' + o.r + "</span>" : "") + (o.sw != null ? '<span class="sw' + (o.sw ? " on" : "") + '"></span>' : "") + (o.chev === false || o.sw != null ? "" : ic("chevR", 18).replace('class="ico"', 'class="ico chev"'));
      return '<div class="row ' + (o.i || o.av || o.lead ? "hasic " : "") + (o.cls || "") + '">' + lead + '<div class="mid"><div class="tt">' + o.t + "</div>" + (o.m ? '<div class="mt">' + o.m + "</div>" : "") + "</div>" + '<div class="rt">' + right + "</div></div>";
    };
    k.group = function (title, rows, foot) {
      return (title ? '<div class="grp-t">' + title + "</div>" : "") + '<div class="grp">' + rows.join("") + "</div>" + (foot ? '<div class="grp-f">' + foot + "</div>" : "");
    };
    k.sh = function (t, link) {
      return '<div class="sh"><span>' + t + "</span>" + (link ? "<a>" + link + "</a>" : "") + "</div>";
    };

    k.btn = function (label, kind, icon, cls) {
      return '<div class="btn ' + (kind || "primary") + " " + (cls || "") + '">' + (icon ? ic(icon, 20) : "") + label + "</div>";
    };
    k.sw = (on) => '<span class="sw' + (on ? " on" : "") + '"></span>';
    k.field = function (label, value, o) {
      o = o || {};
      return '<div class="fld"><label>' + label + '</label><div class="in ' + (o.ph ? "ph " : "") + (o.focus ? "focus " : "") + (o.err ? "err " : "") + '">' + (o.lead ? ic(o.lead, 18) : "") + '<span style="flex:1">' + value + "</span>" + (o.trail ? ic(o.trail, 18) : "") + (o.trailText ? '<span class="muted" style="font-size:14px">' + o.trailText + "</span>" : "") + "</div>" + (o.hint ? '<div class="hint' + (o.err ? " err" : "") + '">' + o.hint + "</div>" : "") + "</div>";
    };
    k.tile = function (label, value, d, o) {
      o = o || {};
      return '<div class="tile">' + '<div class="l">' + (o.i ? ic(o.i, 15) : "") + label + '</div><div class="v">' + value + "</div>" + (d ? '<div class="d">' + d + "</div>" : "") + "</div>";
    };

    k.sheet = function (title, body, o) {
      o = o || {};
      return '<div class="dim"></div><div class="sheet ' + (o.full ? "full " : "") + (ios ? "" : "on-surf") + '" style="' + (o.h ? "height:" + o.h + "px" : "") + '"><div class="grab"></div>' +
        (title ? '<div class="sht"><h5>' + title + "</h5>" + (ios && o.x !== false ? '<span class="x">' + ic("x", 16) + "</span>" : o.right || "") + "</div>" : "") +
        '<div class="shb">' + body + "</div></div>";
    };
    k.dialog = function (title, body, actions) {
      // actions: [[label, "b"(bold/primary)|"d"(destructive)|""]]
      const a = ios ? actions : actions.slice().reverse();
      return '<div class="dim"></div><div class="dlg"><div class="dt">' + title + '</div><div class="db">' + body + '</div><div class="da">' + a.map((x) => '<span class="' + (x[1] || "") + '">' + x[0] + "</span>").join("") + "</div></div>";
    };
    k.toast = function (text, action) {
      return '<div class="toast">' + ic("checkC", 18) + "<span>" + text + "</span>" + (action ? "<b>" + action + "</b>" : "") + "</div>";
    };
    k.fab = function (label, icon, gold) {
      if (ios) return "";
      return '<div class="fab ' + (gold ? "gold " : "") + (label ? "" : "sq") + '">' + ic(icon || "plus", 24) + (label || "") + "</div>";
    };
    // iOS action sheet / Android bottom-sheet menu for row actions.
    k.actions = function (head, items, cancel) {
      if (ios) {
        return '<div class="dim"></div><div class="acts-ios"><div class="g">' + (head ? '<div class="h">' + head + "</div>" : "") +
          items.map((x) => '<span class="' + (x[2] || "") + '">' + x[0] + "</span>").join("") + '</div><div class="g"><span class="c">' + (cancel || "Cancel") + "</span></div></div>";
      }
      return k.sheet(head, '<div style="margin:0 -16px">' + items.map((x) => '<div class="row" style="min-height:52px">' + '<span class="lic plain" style="' + (x[2] === "d" ? "color:var(--bad)" : "") + '">' + ic(x[1] || "chevR", 22) + '</span><div class="mid"><div class="tt" style="' + (x[2] === "d" ? "color:var(--bad)" : "") + '">' + x[0] + "</div></div></div>").join("") + "</div>");
    };
    k.stepper = function (n, cur) {
      let s = '<div class="steps">';
      for (let i = 0; i < n; i++) s += '<i class="' + (i < cur ? "done" : i === cur ? "cur" : "") + '"></i>';
      return s + "</div>";
    };
    k.path = function (stages, cur) {
      return '<div class="path">' + stages.map((s, i) => '<span class="' + (i < cur ? "done" : i === cur ? "cur" : "") + '">' + s + "</span>").join("") + "</div>";
    };
    k.kv = function (pairs) {
      return '<dl class="kv">' + pairs.map((x) => "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>").join("") + "</dl>";
    };
    k.logo = (size) => '<img src="isotype-on-dark.svg" alt="" width="' + (size || 26) + '" height="' + (size || 26) + '" style="display:block">';
    return k;
  }

  // Render one screen for one platform.
  function phone(screen, p) {
    const k = K(p);
    const r = screen.render(k) || {};
    const role = r.role || screen.role || "producer";
    let inner = "";
    if (r.full) {
      inner = r.full;
    } else {
      inner = k.status(r.statusOpt) + (r.header || "") +
        '<div class="bd ' + (r.pad ? "pad" : "") + '">' + (r.body || "") + '<div style="height:' + (r.after ? (r.tab === null ? 130 : 180) : r.tab === null ? 40 : 110) + 'px"></div>' + "</div>" +
        (r.after || "") + (r.fab || "") + (r.tab === null ? "" : k.tabs(role, r.tab || "home", r.badges || screen.badges)) + (r.overlay || "");
    }
    return '<div class="plat ' + p + '"><span class="pl">' + (p === "ios" ? "iOS · iPhone 16" : "Android · Pixel 9") + '</span><div class="dev ' + p + '"><div class="scr' + (screen.light ? " t-light" : "") + '">' + inner + '<div class="homeind"></div></div></div></div>';
  }

  window.MK = { K, phone, ic, chip, I };
  window.SCREENS = window.SCREENS || [];
})();
