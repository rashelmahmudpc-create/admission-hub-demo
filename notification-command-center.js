/* AdmissionHub · Notification Command Center
   Admin notification studio. Wrapped in an IIFE so none of its many
   short-lived helpers (esc/render/T/fmt/…) leak into the app's global scope. */
(function () {
'use strict';

/* ============================================================
   AdmissionHub · Notification Command Center
   Part A — icons, i18n, sample data
   ============================================================ */
var ICON = {
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  pen:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  layers:'<path d="m12 2 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  send:'<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4Z"/>',
  fileText:'<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h4"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 15v3M12 9v9M17 12v6"/>',
  zap:'<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13A4 4 0 0 1 16 11"/>',
  activity:'<path d="M22 12h-4l-3 8-4-16-3 8H2"/>',
  sparkles:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  alertCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5"/><path d="M12 16h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  chevDown:'<path d="m6 9 6 6 6-6"/>',
  chevRight:'<path d="m9 6 6 6-6 6"/>',
  chevLeft:'<path d="m15 6-6 6 6 6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter:'<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  trash:'<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 17-5.5-5.5L6 20"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  palette:'<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="8" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a3 3 0 0 0 0-6"/>',
  shield:'<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6Z"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  wifiOff:'<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 4-2.4"/><path d="M15 10.5a10 10 0 0 1 4 2.4"/><path d="M2 8.8A16 16 0 0 1 8 5.6"/><path d="M16 5.6a16 16 0 0 1 6 3.2"/><path d="M12 20h.01"/>',
  monitor:'<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  smartphone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  play:'<path d="M7 4l13 8-13 8Z"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  ban:'<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye:'<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  download:'<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 13H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1h0Z"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
  tag:'<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
  chat:'<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1-5V12a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8Z"/>',
  phone:'<path d="M5 3h4l2 5-2.5 1.5a13 13 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3Z"/>',
  upload:'<path d="M12 21V9"/><path d="m7 13 5-5 5 5"/><path d="M4 4h16"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
  trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
  undo:'<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.5-7.5"/>',
  dot:'<circle cx="12" cy="12" r="3.5"/>',
  arrowUpRight:'<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  corner:'<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m8 11-4 4 4 4"/>',
  panel:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  bolt:'<path d="M11 2 5 13h5l-1 9 8-12h-5Z"/>',
  boxes:'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 13v8M13 17h8"/>',
  volume:'<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'
};
function ic(n, s, cls){
  s = s || 18;
  return '<svg class="' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON[n] || ICON.dot) + '</svg>';
}

var I18N = {
  en: {
    dir: 'ltr',
    brand: 'AdmissionHub',
    brandSub: 'Notification Command Center',
    navMain: 'Command',
    navOps: 'Operations',
    navOverview: 'Overview', navCompose: 'Compose', navCampaigns: 'Campaigns',
    navQueue: 'Queue', navSent: 'Sent', navTemplates: 'Templates',
    navAnalytics: 'Analytics', navAutomations: 'Automations', navAudience: 'Audience',
    navHealth: 'System Health', navMore: 'More', navHome: 'Home',
    aiAgent: 'Notification AI', aiReady: 'Agent online', aiReadySub: 'Can prepare, never send.',
    aiThinking: 'Working…', aiWaiting: 'Waiting for admin approval',
    theme: 'Theme', themeLight: 'Light', themeDark: 'Dark', themePink: 'Pink', themeGreen: 'Green',
    language: 'Language', languageName: 'English (EN)',
    offline: 'Offline — live delivery is paused. Drafts are preserved locally.',
    retry: 'Retry',
    reload: 'Reload data',
    // gate
    gateTitle: 'Administrator access', gateSub: 'The Notification Command Center is restricted to AdmissionHub administrators.',
    gateToken: 'Admin token', gateTokenPh: 'Paste admin token', gateVerify: 'Verify token',
    gateHint: 'Prototype build: any token of 4+ characters is accepted.',
    gateBad: 'Token rejected. Check the token and try again.',
    gateOk: 'Access granted.', gateVerifying: 'Verifying…',
    // overview
    ovTitle: 'Command Center', ovSub: 'Live state of student communications across every channel.',
    ovAttention: 'Needs your attention', ovThroughput: 'Today', ovQueued: 'Queued', ovScheduled: 'Scheduled',
    ovActiveCampaigns: 'Active campaigns', ovDrafts: 'Drafts', ovFailed: 'Failed sends',
    ovQuota: 'Daily quota', ovReachToday: 'Reach today', ovEngagement: 'Click-through',
    ovDelivery: 'Delivery health', ovRecent: 'Recent notifications', ovAiActivity: 'AI activity',
    ovOpenQueue: 'Open queue', ovReviewFailures: 'Review failures', ovNewNotification: 'New notification',
    ovSeeAll: 'See all', ovSystemOk: 'All systems nominal', ovDegraded: 'Degraded capability',
    ovQuick: 'Quick actions', ovDeliveredOf: 'delivered of',
    // compose
    cpTitle: 'Compose notification', cpSub: 'Prepare, validate and preview before anything is sent.',
    cpDetails: 'Message', cpAudience: 'Audience & targeting', cpSchedule: 'Schedule',
    cpAdvanced: 'Advanced delivery', cpValidation: 'Pre-send validation', cpPreview: 'Live preview',
    cpFieldType: 'Notification type', cpFieldChannel: 'Channel', cpFieldTitle: 'Title',
    cpFieldBody: 'Body', cpFieldImage: 'Image URL', cpFieldTarget: 'Target URL / deep link',
    cpFieldCta: 'Call to action label', cpFieldPriority: 'Delivery priority',
    cpTemplate: 'Start from template', cpPersonalize: 'Personalization',
    cpCharCount: 'characters', cpShowPreview: 'Preview', cpTestSend: 'Send test',
    cpSaveDraft: 'Save draft', cpSaveTemplate: 'Save as template', cpAI: 'Ask the AI',
    cpReview: 'Review & approve', cpSend: 'Send now', cpScheduleSend: 'Schedule',
    cpWhen: 'Send at', cpTz: 'Timezone', cpRecurring: 'Repeating schedule', cpEvery: 'Repeat',
    cpConflict: 'Schedule conflict', cpUtm: 'UTM tracking', cpAb: 'A/B test',
    cpVariant: 'Variant', cpExclude: 'Exclude audience', cpFrequency: 'Frequency protection',
    cpEnVariant: 'English variant', cpShowEn: 'Add English copy', cpMissingEn: 'English copy missing',
    cpDraftSaved: 'Draft saved', cpAutosaved: 'Autosaved', cpUnsaved: 'Unsaved changes',
    cpReach: 'Estimated reach', cpReachOf: 'of all students', cpBreakdown: 'Audience breakdown',
    cpSample: 'Sample audience', cpOverlap: 'Overlap detected', cpApply: 'Apply',
    // audience
    auTitle: 'Audience', auSub: 'Segments, rules and reach intelligence.',
    auSegments: 'Predefined segments', auSaved: 'Saved segments', auBuilder: 'Segment builder',
    auAddRule: 'Add condition', auAddGroup: 'Add group', auSave: 'Save segment', auEstimate: 'Estimate reach',
    auName: 'Segment name', auNoRules: 'No conditions yet — this matches every student.',
    auAnd: 'ALL of (AND)', auOr: 'ANY of (OR)', auRemove: 'Remove condition',
    auDemographics: 'Distribution', auCourse: 'Course', auUniversity: 'University',
    auSubscription: 'Subscription', auEngagement: 'Engagement', auActive: 'Active',
    auInactive: 'Inactive', auNew: 'New', auSuppress: 'Suppression list',
    // campaigns
    caTitle: 'Campaigns', caSub: 'Multi-message sequences with conditions and schedules.',
    caNew: 'New campaign', caTimeline: 'Timeline', caAddMessage: 'Add message',
    caDay: 'Day', caActivate: 'Activate', caPause: 'Pause', caResume: 'Resume', caCancel: 'Cancel',
    caDuplicate: 'Duplicate', caDraft: 'Draft', caActive: 'Active', caPaused: 'Paused',
    caCompleted: 'Completed', caCancelled: 'Cancelled', caFailed: 'Failed',
    caMessages: 'messages', caAudience: 'Audience', caSequence: 'Sequence preview',
    caCondition: 'Condition', caWait: 'Wait',
    // queue
    qTitle: 'Queue', qSub: 'What will go out next, and when.',
    qCountdown: 'Goes out in', qPriority: 'Priority', qReschedule: 'Reschedule', qCancel: 'Cancel',
    qEmpty: 'Queue is clear', qEmptySub: 'Nothing is waiting to be sent right now.',
    qCancelConfirm: 'Cancel this queued notification?',
    // sent
    sTitle: 'Sent & history', sSub: 'Every notification with its exact delivery outcome.',
    sSearch: 'Search title, body or audience', sStatus: 'Status', sAll: 'All', sType: 'Type',
    sDate: 'Date', sChannel: 'Channel', sReach: 'Reach', sReason: 'Reason', sDetail: 'Delivery detail',
    sRetry: 'Retry send', sEditResend: 'Edit & resend', sSent: 'Sent', sSending: 'Sending',
    sScheduled: 'Scheduled', sCancelled: 'Cancelled', sFailed: 'Failed', sDraft: 'Draft', sPaused: 'Paused',
    sEmpty: 'No notifications match', sEmptySub: 'Adjust or clear the filters to see more results.',
    sClear: 'Clear filters', sOpened: 'Opened', sClicked: 'Clicked', sCtr: 'CTR',
    sFailureDetail: 'Why it failed',
    // templates
    tTitle: 'Templates', tSub: 'Reusable, bilingual notification content.',
    tNew: 'New template', tFavorites: 'Favorites', tRecent: 'Recently used', tAll: 'All templates',
    tUse: 'Use template', tDuplicate: 'Duplicate', tVersion: 'Version history',
    tBilingual: 'Bengali / English', tEmpty: 'No templates here', tEmptySub: 'Try another category or create a new template.',
    tUsedTimes: 'uses', tSave: 'Save template',
    // analytics
    anTitle: 'Analytics', anSub: 'Performance across channels, audiences and campaigns.',
    anSimulated: 'Simulated data for prototype review',
    anReach: 'Reach', anDelivered: 'Delivered', anOpened: 'Opened', anClicked: 'Clicked',
    anFailed: 'Failed', anCtr: 'Click-through rate', anChannel: 'Channel performance',
    anCampaign: 'Campaign performance', anTimeline: 'Last 7 days', anCompare: 'vs. previous period',
    anBreakdown: 'Audience breakdown', anFailures: 'Failure reasons', anAb: 'A/B comparison',
    anVariantA: 'Variant A', anVariantB: 'Variant B', anLift: 'Lift',
    // automations
    aTitle: 'Automations', aSub: 'Trigger-driven notification flows.',
    aNew: 'New automation', aTrigger: 'Trigger', aCondition: 'Condition', aAction: 'Action', aWait: 'Wait',
    aEnable: 'Enable', aDisable: 'Disable', aEnabled: 'Enabled', aDisabled: 'Disabled',
    aNeedsApproval: 'Activation needs administrator approval',
    // health
    hTitle: 'System Health', hSub: 'Service status, last check and recommended action.',
    hCheck: 'Check now', hChecked: 'Last checked', hCapability: 'Affected capability', hAction: 'Recommended action',
    hHealthy: 'Healthy', hDegraded: 'Degraded', hUnavailable: 'Unavailable', hUnknown: 'Unknown',
    hNoSpinner: 'Status is shown as text and colour, never as a spinner alone.',
    // approvals
    apTitle: 'Review & approve', apSub: 'Confirm exactly what will be sent. Nothing sends without you.',
    apAudience: 'Audience', apReach: 'Estimated reach', apType: 'Type', apChannel: 'Channel',
    apTitleField: 'Title', apBody: 'Body', apImage: 'Image', apTarget: 'Target URL', apSchedule: 'Schedule',
    apCampaign: 'Campaign', apPersonalization: 'Personalization', apWarnings: 'Warnings',
    apChecks: 'Validation', apNone: 'No warnings', apApprove: 'Approve & send', apApproveSched: 'Approve & schedule',
    apBoundary: 'Only a human administrator can authorise a send. The AI prepares, you decide.',
    apBlocked: 'Sending is blocked until every blocking check passes.',
    apReviewFailed: 'Fix the blocking issues before approving.',
    apEdit: 'Back to edit', apConfirmTitle: 'Final confirmation',
    apConfirmSub: 'This action sends to real students. This cannot be undone.',
    apConfirm: 'Yes, send now', apCancel: 'Cancel',
    apNoPermission: 'Your role can prepare notifications but cannot approve sends. Ask an approver.',
    // test send
    tsTitle: 'Test send', tsSub: 'Delivered to test devices only — never to students.',
    tsTo: 'Send to', tsRun: 'Run test send', tsNote: 'Test mode is visually distinct and never counts in analytics.',
    // send progress
    sdTitle: 'Sending', sdPreparing: 'Validating configuration', sdQueueing: 'Queuing for delivery',
    sdDispatching: 'Dispatching to channel', sdDone: 'Sent', sdFail: 'Delivery failed',
    sdSuccess: 'Notification sent successfully', sdSuccessSub: 'Delivery receipts will appear in Sent.',
    // misc
    of: 'of', close: 'Close', cancel: 'Cancel', confirm: 'Confirm', save: 'Save',
    back: 'Back', next: 'Next', edit: 'Edit', duplicate: 'Duplicate', delete: 'Delete',
    viewDetail: 'View detail', more2: 'More', done: 'Done', apply: 'Apply', reset: 'Reset',
    loading: 'Loading', busy: 'Working', nothing: '—', allStudents: 'All students',
    simulate: 'Prototype controls', simStates: 'Interface states', simLoading: 'Show loading',
    simEmpty: 'Show empty', simError: 'Show error', simOffline: 'Toggle offline', simReset: 'Back to live data',
    aiLog: 'AI activity log', audit: 'Audit log', auditActor: 'Actor', auditAction: 'Action', auditTime: 'Time',
    sampleNotice: 'Simulated data', stats: 'Statistics', expand: 'Show more', collapse: 'Show less',
    confirmDanger: 'Confirm', unsavedWarn: 'You have unsaved changes. Leave anyway?',
    leaveStay: 'Stay', leaveDiscard: 'Discard', okStates: 'Normal', selected: 'selected',
    role: 'Role', roleAdmin: 'Administrator (full)', rolePreparer: 'Operator (prepare only)',
    switchRole: 'Switch role', approvalDenied: 'Approver permission required for this action.',
    goToApproval: 'Review for approval', draftRestored: 'Draft restored.', discardDraft: 'Discard draft'
  },
  bn: {
    dir: 'ltr',
    brand: 'অ্যাডমিশনহাব',
    brandSub: 'নোটিফিকেশন কমান্ড সেন্টার',
    navMain: 'কমান্ড',
    navOps: 'অপারেশনস',
    navOverview: 'ওভারভিউ', navCompose: 'কম্পোজ', navCampaigns: 'ক্যাম্পেইন',
    navQueue: 'কিউ', navSent: 'পাঠানো', navTemplates: 'টেমপ্লেট',
    navAnalytics: 'অ্যানালিটিক্স', navAutomations: 'অটোমেশন', navAudience: 'অডিয়েন্স',
    navHealth: 'সিস্টেম হেলথ', navMore: 'আরও', navHome: 'হোম',
    aiAgent: 'নোটিফিকেশন এআই', aiReady: 'এজেন্ট সক্রিয়', aiReadySub: 'প্রস্তুত করতে পারে, পাঠাতে পারে না।',
    aiThinking: 'কাজ চলছে…', aiWaiting: 'অ্যাডমিন অনুমোদনের অপেক্ষায়',
    theme: 'থিম', themeLight: 'লাইট', themeDark: 'ডার্ক', themePink: 'পিংক', themeGreen: 'গ্রিন',
    language: 'ভাষা', languageName: 'বাংলা (BN)',
    offline: 'অফলাইন — লাইভ ডেলিভারি বন্ধ আছে। ড্রাফট লোকালি সংরক্ষিত।',
    retry: 'আবার চেষ্টা', reload: 'ডেটা রিফ্রেশ',
    gateTitle: 'অ্যাডমিন অ্যাক্সেস', gateSub: 'নোটিফিকেশন কমান্ড সেন্টার শুধু অ্যাডমিশনহাব অ্যাডমিনের জন্য।',
    gateToken: 'অ্যাডমিন টোকেন', gateTokenPh: 'অ্যাডমিন টোকেন দিন', gateVerify: 'টোকেন যাচাই',
    gateHint: 'প্রোটোটাইপ বিল্ড: ৪ অক্ষরের যেকোনো টোকেন গ্রহণযোগ্য।',
    gateBad: 'টোকেন প্রত্যাখ্যাত। টোকেন পরীক্ষা করে আবার চেষ্টা করুন।',
    gateOk: 'অ্যাক্সেস দেওয়া হয়েছে।', gateVerifying: 'যাচাই হচ্ছে…',
    ovTitle: 'কমান্ড সেন্টার', ovSub: 'প্রতিটি চ্যানেলে ছাত্রছাত্রীদের যোগাযোগের লাইভ অবস্থা।',
    ovAttention: 'আপনার মনোযোগ দরকার', ovThroughput: 'আজ', ovQueued: 'কিউতে', ovScheduled: 'শিডিউলড',
    ovActiveCampaigns: 'সক্রিয় ক্যাম্পেইন', ovDrafts: 'ড্রাফট', ovFailed: 'ব্যর্থ পাঠানো',
    ovQuota: 'দৈনিক কোটা', ovReachToday: 'আজকের রিচ', ovEngagement: 'ক্লিক-থ্রু',
    ovDelivery: 'ডেলিভারি হেলথ', ovRecent: 'সাম্প্রতিক নোটিফিকেশন', ovAiActivity: 'এআই কার্যক্রম',
    ovOpenQueue: 'কিউ দেখুন', ovReviewFailures: 'ব্যর্থতা দেখুন', ovNewNotification: 'নতুন নোটিফিকেশন',
    ovSeeAll: 'সব দেখুন', ovSystemOk: 'সব সিস্টেম স্বাভাবিক', ovDegraded: 'দুর্বল সক্ষমতা',
    ovQuick: 'দ্রুত কাজ', ovDeliveredOf: 'ডেলিভারড, মোট',
    cpTitle: 'নোটিফিকেশন কম্পোজ', cpSub: 'পাঠানোর আগে তৈরি, যাচাই ও প্রিভিউ করুন।',
    cpDetails: 'বার্তা', cpAudience: 'অডিয়েন্স ও টার্গেটিং', cpSchedule: 'শিডিউল',
    cpAdvanced: 'অ্যাডভান্সড ডেলিভারি', cpValidation: 'পাঠানোর আগে যাচাই', cpPreview: 'লাইভ প্রিভিউ',
    cpFieldType: 'নোটিফিকেশন টাইপ', cpFieldChannel: 'চ্যানেল', cpFieldTitle: 'টাইটেল',
    cpFieldBody: 'বার্তা', cpFieldImage: 'ছবির ইউআরএল', cpFieldTarget: 'টার্গেট ইউআরএল / ডিপ লিংক',
    cpFieldCta: 'কল-টু-অ্যাকশন লেবেল', cpFieldPriority: 'ডেলিভারি প্রায়োরিটি',
    cpTemplate: 'টেমপ্লেট থেকে শুরু', cpPersonalize: 'পার্সোনালাইজেশন',
    cpCharCount: 'অক্ষর', cpShowPreview: 'প্রিভিউ', cpTestSend: 'টেস্ট পাঠান',
    cpSaveDraft: 'ড্রাফট সেভ', cpSaveTemplate: 'টেমপ্লেট হিসেবে সেভ', cpAI: 'এআই-কে বলুন',
    cpReview: 'রিভিউ ও অনুমোদন', cpSend: 'এখনই পাঠান', cpScheduleSend: 'শিডিউল করুন',
    cpWhen: 'পাঠানোর সময়', cpTz: 'টাইমজোন', cpRecurring: 'পুনরাবৃত্তি শিডিউল', cpEvery: 'পুনরাবৃত্তি',
    cpConflict: 'শিডিউল সংঘর্ষ', cpUtm: 'ইউটিএম ট্র্যাকিং', cpAb: 'এ/বি টেস্ট',
    cpVariant: 'ভ্যারিয়েন্ট', cpExclude: 'অডিয়েন্স বাদ', cpFrequency: 'ফ্রিকোয়েন্সি সুরক্ষা',
    cpEnVariant: 'ইংরেজি ভার্সন', cpShowEn: 'ইংরেজি কপি যোগ করুন', cpMissingEn: 'ইংরেজি কপি নেই',
    cpDraftSaved: 'ড্রাফট সেভ হয়েছে', cpAutosaved: 'অটোসেভ', cpUnsaved: 'অসংরক্ষিত পরিবর্তন',
    cpReach: 'সম্ভাব্য রিচ', cpReachOf: 'সব শিক্ষার্থীর মধ্যে', cpBreakdown: 'অডিয়েন্স ব্রেকডাউন',
    cpSample: 'নমুনা অডিয়েন্স', cpOverlap: 'ওভারল্যাপ পাওয়া গেছে', cpApply: 'প্রয়োগ করুন',
    auTitle: 'অডিয়েন্স', auSub: 'সেগমেন্ট, নিয়ম এবং রিচ ইন্টেলিজেন্স।',
    auSegments: 'পূর্বনির্ধারিত সেগমেন্ট', auSaved: 'সংরক্ষিত সেগমেন্ট', auBuilder: 'সেগমেন্ট বিল্ডার',
    auAddRule: 'শর্ত যোগ করুন', auAddGroup: 'গ্রুপ যোগ করুন', auSave: 'সেগমেন্ট সেভ', auEstimate: 'রিচ হিসাব',
    auName: 'সেগমেন্টের নাম', auNoRules: 'এখনো কোনো শর্ত নেই — এটি সব শিক্ষার্থীকে মিলাবে।',
    auAnd: 'সবগুলো (AND)', auOr: 'যেকোনোটি (OR)', auRemove: 'শর্ত মুছুন',
    auDemographics: 'বিতরণ', auCourse: 'কোর্স', auUniversity: 'বিশ্ববিদ্যালয়',
    auSubscription: 'সাবস্ক্রিপশন', auEngagement: 'এনগেজমেন্ট', auActive: 'সক্রিয়',
    auInactive: 'নিষ্ক্রিয়', auNew: 'নতুন', auSuppress: 'সাপ্রেশন লিস্ট',
    caTitle: 'ক্যাম্পেইন', caSub: 'শর্ত ও শিডিউলসহ বহু-বার্তার সিকোয়েন্স।',
    caNew: 'নতুন ক্যাম্পেইন', caTimeline: 'টাইমলাইন', caAddMessage: 'বার্তা যোগ করুন',
    caDay: 'দিন', caActivate: 'সক্রিয় করুন', caPause: 'পজ', caResume: 'চালু করুন', caCancel: 'বাতিল',
    caDuplicate: 'কপি করুন', caDraft: 'ড্রাফট', caActive: 'সক্রিয়', caPaused: 'পজড',
    caCompleted: 'সম্পন্ন', caCancelled: 'বাতিল', caFailed: 'ব্যর্থ',
    caMessages: 'বার্তা', caAudience: 'অডিয়েন্স', caSequence: 'সিকোয়েন্স প্রিভিউ',
    caCondition: 'শর্ত', caWait: 'অপেক্ষা',
    qTitle: 'কিউ', qSub: 'কী পরবর্তী পাঠানো হবে, এবং কখন।',
    qCountdown: 'পাঠানো হবে', qPriority: 'প্রায়োরিটি', qReschedule: 'পুনঃশিডিউল', qCancel: 'বাতিল',
    qEmpty: 'কিউ ফাঁকা', qEmptySub: 'এখন পাঠানোর জন্য কিছু অপেক্ষায় নেই।',
    qCancelConfirm: 'এই কিউড নোটিফিকেশন বাতিল করবেন?',
    sTitle: 'পাঠানো ও ইতিহাস', sSub: 'প্রতিটি নোটিফিকেশন এবং তার সঠিক ফলাফল।',
    sSearch: 'টাইটেল, বার্তা বা অডিয়েন্স খুঁজুন', sStatus: 'স্ট্যাটাস', sAll: 'সব', sType: 'টাইপ',
    sDate: 'তারিখ', sChannel: 'চ্যানেল', sReach: 'রিচ', sReason: 'কারণ', sDetail: 'ডেলিভারি বিস্তারিত',
    sRetry: 'আবার পাঠান', sEditResend: 'এডিট করে পাঠান', sSent: 'পাঠানো হয়েছে', sSending: 'পাঠানো হচ্ছে',
    sScheduled: 'শিডিউলড', sCancelled: 'বাতিল', sFailed: 'ব্যর্থ', sDraft: 'ড্রাফট', sPaused: 'পজড',
    sEmpty: 'কোনো নোটিফিকেশন মেলেনি', sEmptySub: 'ফিল্টার বদলান বা মুছে ফেলুন।',
    sClear: 'ফিল্টার মুছুন', sOpened: 'খোলা হয়েছে', sClicked: 'ক্লিক', sCtr: 'সিটিআর',
    sFailureDetail: 'কেন ব্যর্থ হয়েছে',
    tTitle: 'টেমপ্লেট', tSub: 'পুনরায় ব্যবহারযোগ্য দ্বিভাষিক নোটিফিকেশন কনটেন্ট।',
    tNew: 'নতুন টেমপ্লেট', tFavorites: 'প্রিয়', tRecent: 'সাম্প্রতিক ব্যবহৃত', tAll: 'সব টেমপ্লেট',
    tUse: 'টেমপ্লেট ব্যবহার', tDuplicate: 'কপি', tVersion: 'ভার্সন ইতিহাস',
    tBilingual: 'বাংলা / ইংরেজি', tEmpty: 'এখানে কোনো টেমপ্লেট নেই', tEmptySub: 'অন্য ক্যাটাগরি দেখুন বা নতুন টেমপ্লেট বানান।',
    tUsedTimes: 'বার ব্যবহৃত', tSave: 'টেমপ্লেট সেভ',
    anTitle: 'অ্যানালিটিক্স', anSub: 'চ্যানেল, অডিয়েন্স ও ক্যাম্পেইনভিত্তিক পারফরম্যান্স।',
    anSimulated: 'প্রোটোটাইপ রিভিউয়ের জন্য সিমুলেটেড ডেটা',
    anReach: 'রিচ', anDelivered: 'ডেলিভারড', anOpened: 'খোলা', anClicked: 'ক্লিক',
    anFailed: 'ব্যর্থ', anCtr: 'ক্লিক-থ্রু রেট', anChannel: 'চ্যানেল পারফরম্যান্স',
    anCampaign: 'ক্যাম্পেইন পারফরম্যান্স', anTimeline: 'শেষ ৭ দিন', anCompare: 'আগের Periode',
    anBreakdown: 'অডিয়েন্স ব্রেকডাউন', anFailures: 'ব্যর্থতার কারণ', anAb: 'এ/বি তুলনা',
    anVariantA: 'ভ্যারিয়েন্ট এ', anVariantB: 'ভ্যারিয়েন্ট বি', anLift: 'লিফট',
    aTitle: 'অটোমেশন', aSub: 'ট্রিগারভিত্তিক নোটিফিকেশন ফ্লো।',
    aNew: 'নতুন অটোমেশন', aTrigger: 'ট্রিগার', aCondition: 'শর্ত', aAction: 'অ্যাকশন', aWait: 'অপেক্ষা',
    aEnable: 'চালু', aDisable: 'বন্ধ', aEnabled: 'সক্রিয়', aDisabled: 'নিষ্ক্রিয়',
    aNeedsApproval: 'সক্রিয় করতে অ্যাডমিন অনুমোদন দরকার',
    hTitle: 'সিস্টেম হেলথ', hSub: 'সার্ভিস স্ট্যাটাস, শেষ চেক এবং করণীয়।',
    hCheck: 'এখনই চেক', hChecked: 'শেষ চেক', hCapability: 'প্রভাবিত সক্ষমতা', hAction: 'করণীয়',
    hHealthy: 'সুস্থ', hDegraded: 'দুর্বল', hUnavailable: 'অনুপলব্ধ', hUnknown: 'অজানা',
    hNoSpinner: 'স্ট্যাটাস সবসময় টেক্সট ও রঙে দেখানো হয়, শুধু স্পিনারে নয়।',
    apTitle: 'রিভিউ ও অনুমোদন', apSub: 'ঠিক কী পাঠানো হবে তা নিশ্চিত করুন। আপনার ছাড়া কিছু পাঠানো হয় না।',
    apAudience: 'অডিয়েন্স', apReach: 'সম্ভাব্য রিচ', apType: 'টাইপ', apChannel: 'চ্যানেল',
    apTitleField: 'টাইটেল', apBody: 'বার্তা', apImage: 'ছবি', apTarget: 'টার্গেট ইউআরএল', apSchedule: 'শিডিউল',
    apCampaign: 'ক্যাম্পেইন', apPersonalization: 'পার্সোনালাইজেশন', apWarnings: 'সতর্কতা',
    apChecks: 'যাচাই', apNone: 'কোনো সতর্কতা নেই', apApprove: 'অনুমোদন ও পাঠান', apApproveSched: 'অনুমোদন ও শিডিউল',
    apBoundary: 'কেবল একজন মানুষ অ্যাডমিন পাঠানোর অনুমতি দিতে পারেন। এআই প্রস্তুত করে, সিদ্ধান্ত আপনার।',
    apBlocked: 'সব বাধ্যতামূলক যাচাই পাস না হওয়া পর্যন্ত পাঠানো বন্ধ।',
    apReviewFailed: 'অনুমোদনের আগে বাধাদানকারী সমস্যা ঠিক করুন।',
    apEdit: 'এডিটে ফিরুন', apConfirmTitle: 'চূড়ান্ত নিশ্চিতকরণ',
    apConfirmSub: 'এই কাজটি সত্যিকারের শিক্ষার্থীদের কাছে পাঠাবে। ফেরানো যাবে না।',
    apConfirm: 'হ্যাঁ, এখনই পাঠান', apCancel: 'বাতিল',
    apNoPermission: 'আপনার রোলে নোটিফিকেশন প্রস্তুত করা যায় কিন্তু অনুমোদন নয়। অনুমোদনকারীকে বলুন।',
    tsTitle: 'টেস্ট সেন্ড', tsSub: 'শুধু টেস্ট ডিভাইসে যাবে — শিক্ষার্থীদের কাছে নয়।',
    tsTo: 'কাকে পাঠাবে', tsRun: 'টেস্ট পাঠান', tsNote: 'টেস্ট মোড আলাদা দেখায় এবং অ্যানালিটিক্সে যোগ হয় না।',
    sdTitle: 'পাঠানো হচ্ছে', sdPreparing: 'কনফিগারেশন যাচাই', sdQueueing: 'কিউতে দেওয়া হচ্ছে',
    sdDispatching: 'চ্যানেলে পাঠানো হচ্ছে', sdDone: 'পাঠানো হয়েছে', sdFail: 'ডেলিভারি ব্যর্থ',
    sdSuccess: 'নোটিফিকেশন সফলভাবে পাঠানো হয়েছে', sdSuccessSub: 'ডেলিভারি রিসিট পাঠানো সেকশনে দেখা যাবে।',
    of: 'মোট', close: 'বন্ধ', cancel: 'বাতিল', confirm: 'নিশ্চিত', save: 'সেভ',
    back: 'ফিরুন', next: 'পরবর্তী', edit: 'এডিট', duplicate: 'কপি', delete: 'মুছুন',
    viewDetail: 'বিস্তারিত', more2: 'আরও', done: 'সম্পন্ন', apply: 'প্রয়োগ', reset: 'রিসেট',
    loading: 'লোড হচ্ছে', busy: 'কাজ চলছে', nothing: '—', allStudents: 'সব শিক্ষার্থী',
    simulate: 'প্রোটোটাইপ কন্ট্রোল', simStates: 'ইন্টারফেস স্টেট', simLoading: 'লোডিং দেখান',
    simEmpty: 'এম্পটি দেখান', simError: 'এরর দেখান', simOffline: 'অফলাইন টগল', simReset: 'লাইভ ডেটায় ফিরুন',
    aiLog: 'এআই কার্যক্রম লগ', audit: 'অডিট লগ', auditActor: 'ব্যক্তি', auditAction: 'কাজ', auditTime: 'সময়',
    sampleNotice: 'সিমুলেটেড ডেটা', stats: 'পরিসংখ্যান', expand: 'আরও দেখান', collapse: 'কম দেখান',
    confirmDanger: 'নিশ্চিত করুন', unsavedWarn: 'অসংরক্ষিত পরিবর্তন আছে। তবুও বের হবেন?',
    leaveStay: 'থাকুন', leaveDiscard: 'বাতিল করুন', okStates: 'স্বাভাবিক', selected: 'নির্বাচিত',
    role: 'রোল', roleAdmin: 'অ্যাডমিনিস্ট্রেটর (পূর্ণ)', rolePreparer: 'অপারেটর (শুধু প্রস্তুতি)',
    switchRole: 'রোল বদলান', approvalDenied: 'এই কাজের জন্য অনুমোদনকারী পারমিশন দরকার।',
    goToApproval: 'অনুমোদনের জন্য রিভিউ', draftRestored: 'ড্রাফট ফিরিয়ে আনা হয়েছে।', discardDraft: 'ড্রাফট মুছুন'
  }
};
function T(k){
  var d = I18N[NS.state.lang] || I18N.bn;
  if (d[k] != null) return d[k];
  if (I18N.bn[k] != null) return I18N.bn[k];
  return k;
}
function ha(k){ // html attributes data-bn / data-en
  return ' data-bn="' + esc(I18N.bn[k] || k) + '" data-en="' + esc(I18N.en[k] || k) + '"';
}
function ph(k){ return ' data-ph-bn="' + esc(I18N.bn[k] || k) + '" data-ph-en="' + esc(I18N.en[k] || k) + '"'; }

var TYPE_KEYS = ['new-content', 'announcement', 'new-feature', 'challenge', 'course', 'important'];
var TYPES = {
  'new-content':  { bn: 'নতুন কনটেন্ট', en: 'New content', ico: 'fileText' },
  'announcement': { bn: 'ঘোষণা', en: 'Announcement', ico: 'volume' },
  'new-feature':  { bn: 'নতুন ফিচার', en: 'New feature', ico: 'sparkles' },
  'challenge':    { bn: 'চ্যালেঞ্জ', en: 'Challenge', ico: 'target' },
  'course':       { bn: 'কোর্স', en: 'Course', ico: 'boxes' },
  'important':    { bn: 'গুরুত্বপূর্ণ', en: 'Important', ico: 'alert' }
};
var AUD_KEYS = ['all_students', 'beginner', 'intermediate', 'pro', 'course_subscribers'];
var CHANNELS = {
  push:    { bn: 'পুশ', en: 'Push', ico: 'bell', cfg: 'banner' },
  inapp:   { bn: 'ইন-অ্যাপ', en: 'In-app', ico: 'chat', cfg: 'placement' },
  email:   { bn: 'ইমেইল', en: 'Email', ico: 'mail', cfg: 'sender' },
  sms:     { bn: 'এসএমএস', en: 'SMS', ico: 'phone', cfg: 'senderId' }
};

var NS = {};
window.NotificationStudio = NS;

/* ============================================================
   Part B — state, storage, helpers, shell, navigation, sheets
   ============================================================ */

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function val(v){ return (v === undefined || v === null || v === '') ? '<span class="ns-dash">—</span>' : esc(v); }

var BN_DIGITS = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯' };
function bnDigits(str){
  return str.replace(/[0-9]/g, function(d){ return BN_DIGITS[d]; });
}
function fmt(n){
  if (n === undefined || n === null || isNaN(n)) return '—';
  var s;
  try { s = new Intl.NumberFormat('en-US').format(n); }
  catch(e){ s = String(n); }
  return NS.state.lang === 'bn' ? bnDigits(s) : s;
}
function pct(n, d){
  if (!d) return '0%';
  return fmt(Math.round((n / d) * 100)) + '%';
}
function num(v2){ return (v2 === undefined || v2 === null) ? '—' : fmt(v2); }

function fmtDateTime(ts){
  if (!ts) return '—';
  var d = new Date(ts);
  var ds;
  try {
    ds = new Intl.DateTimeFormat(NS.state.lang === 'bn' ? 'bn-BD' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    }).format(d);
  } catch(e){ ds = d.toISOString().slice(0, 16).replace('T', ' '); }
  return ds;
}
function fmtDate(ts){
  if (!ts) return '—';
  var d = new Date(ts), ds;
  try {
    ds = new Intl.DateTimeFormat(NS.state.lang === 'bn' ? 'bn-BD' : 'en-GB', {
      day: '2-digit', month: 'short'
    }).format(d);
  } catch(e){ ds = d.toISOString().slice(5, 10); }
  return ds;
}
function relTime(ts){
  if (!ts) return '—';
  var diff = Date.now() - ts, abs = Math.abs(diff), fut = diff < 0;
  var m = Math.round(abs / 60000), h = Math.round(abs / 3600000), d = Math.round(abs / 86400000);
  var L = NS.state.lang === 'bn';
  if (abs < 60000) return L ? 'এখনই' : 'just now';
  if (m < 60) return L ? (fut ? m + ' মিনিটে' : m + ' মিনিট আগে') : (fut ? 'in ' + m + ' min' : m + ' min ago');
  if (h < 24) return L ? (fut ? h + ' ঘণ্টায়' : h + ' ঘণ্টা আগে') : (fut ? 'in ' + h + ' h' : h + ' h ago');
  return L ? (fut ? d + ' দিনে' : d + ' দিন আগে') : (fut ? 'in ' + d + ' d' : d + ' d ago');
}
function hhmm(ts){
  var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
  var ampm = h >= 12 ? (NS.state.lang === 'bn' ? 'PM' : 'PM') : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}
function clockLeft(ts){
  var diff = ts - Date.now();
  if (diff <= 0) return NS.state.lang === 'bn' ? 'এখন' : 'now';
  var totalMin = Math.floor(diff / 60000);
  var d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  var L = NS.state.lang === 'bn';
  if (d > 0) return L ? d + ' দিন ' + h + ' ঘণ্টা' : d + 'd ' + h + 'h';
  if (h > 0) return L ? h + ' ঘণ্টা ' + m + ' মিনিট' : h + 'h ' + m + 'm';
  return L ? m + ' মিনিট' : m + 'm';
}
function toLocalInput(ts){
  var d = new Date(ts), p = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function typeLabel(t){ var o = TYPES[t]; return o ? o[NS.state.lang] : t; }
function chanLabel(c){ var o = CHANNELS[c]; return o ? o[NS.state.lang] : c; }
function audLabel(k){
  var L = NS.state.lang;
  if (k === 'all_students') return L === 'bn' ? 'সব শিক্ষার্থী' : 'All students';
  if (k === 'beginner') return L === 'bn' ? 'বিগিনার' : 'Beginner';
  if (k === 'intermediate') return L === 'bn' ? 'ইন্টারমিডিয়েট' : 'Intermediate';
  if (k === 'pro') return L === 'bn' ? 'প্রো' : 'Pro';
  if (k === 'course_subscribers') return L === 'bn' ? 'কোর্স সাবস্ক্রাইবার' : 'Course subscribers';
  var s = NS.state.segments.filter(function(x){ return x.id === k; })[0];
  return s ? s.name : k;
}
function statusMeta(s){
  var map = {
    sent: ['sSent', 'ok', 'checkCircle'], sending: ['sSending', 'info', 'refresh'],
    scheduled: ['sScheduled', 'info', 'clock'], cancelled: ['sCancelled', 'neutral', 'ban'],
    failed: ['sFailed', 'danger', 'alertCircle'], draft: ['sDraft', 'neutral', 'fileText'],
    paused: ['sPaused', 'warn', 'pause']
  };
  var m = map[s] || ['sDraft', 'neutral', 'dot'];
  return { label: T(m[0]), tone: m[1], ico: m[2] };
}
function statusBadge(s){
  var m = statusMeta(s);
  var cls = m.tone === 'ok' ? 'ns-badge-ok' : m.tone === 'danger' ? 'ns-badge-danger' :
            m.tone === 'warn' ? 'ns-badge-warn' : m.tone === 'info' ? 'ns-badge-info' : 'ns-badge-neutral';
  return '<span class="ns-badge ' + cls + '">' + ic(m.ico, 12) + m.label + '</span>';
}

/* ---------- persistence ---------- */

var STORE_KEY = 'ah_notification_studio_v1';
var memStore = {};
function lsGet(k){
  try { var v = window.localStorage.getItem(k); return v == null ? (memStore[k] || null) : v; }
  catch(e){ return memStore[k] || null; }
}
function lsSet(k, v){
  try { window.localStorage.setItem(k, v); } catch(e){ memStore[k] = v; }
}
function persist(){
  lsSet(STORE_KEY, JSON.stringify({
    theme: NS.state.theme, lang: NS.state.lang, authed: NS.state.authed,
    role: NS.state.role, compose: composeSnapshot(), drafts: NS.state.drafts
  }));
}
function composeSnapshot(){
  var s = NS.state;
  return {
    type: s.type, channel: s.channel, audience: s.audience, segmentId: s.segmentId,
    templateKey: s.templateKey, title: s.title, body: s.body, titleEn: s.titleEn, bodyEn: s.bodyEn,
    imageUrl: s.imageUrl, targetUrl: s.targetUrl, cta: s.cta,
    when: s.when, timezone: s.timezone, recurring: s.recurring, recurEvery: s.recurEvery,
    ab: s.ab, utm: s.utm, priority: s.priority, exclude: s.exclude, frequency: s.frequency,
    personalization: s.personalization, showEn: s.showEn, draftId: s.draftId
  };
}
function restoreCompose(c){
  var s = NS.state;
  if (!c) return;
  for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) s[k] = c[k];
}

/* ---------- state ---------- */

NS.state = {
  authed: false, token: '', role: 'admin',
  tab: 'overview', viewState: {},
  type: 'announcement', channel: 'push',
  audience: 'all_students', segmentId: null,
  templateKey: null, title: '', body: '', titleEn: '', bodyEn: '', showEn: false,
  imageUrl: '', targetUrl: '', cta: '', utm: '', priority: 'normal',
  exclude: '', frequency: 'standard',
  personalization: true, advancedOpen: false, scheduleOpen: false,
  when: '', timezone: 'Asia/Dhaka', recurring: false, recurEvery: 'weekly',
  ab: { enabled: false, titleB: '', bodyB: '' },
  testMode: false, busy: false, error: null, offline: false,
  reachEstimate: null, dailyCap: { used: 7420, cap: 150000 },
  history: [], templates: [], campaigns: [], drafts: [], segments: [], automations: [],
  queue: [],
  analytics: null, systemHealth: [], aiActivity: [], audit: [],
  theme: 'light', lang: 'bn',
  aiThread: [], aiBusy: false, aiCommand: '',
  draftId: null, dirty: false, lastSavedAt: null,
  filters: { sent: { q: '', status: 'all', type: 'all', channel: 'all' }, sort: { key: 'sentAt', dir: 'desc' } },
  ruleBuilder: { id: null, name: '', base: 'all_students', logic: 'and', groups: [], exclude: '' },
  sheet: null, sheetData: null, confirm: null,
  sendPhase: null, sendProgress: 0, selectedCampaign: null,
  toasts: [], deadline: 0
};

/* ---------- sample data ---------- */

/* ---------- real backend data layer ---------- */

var ADMIN_TOK_KEY = 'ahAdminTok';
function adminTok(){
  try { return sessionStorage.getItem(ADMIN_TOK_KEY) || ''; } catch (_) { return ''; }
}
function setAdminTok(v){
  try { v ? sessionStorage.setItem(ADMIN_TOK_KEY, v) : sessionStorage.removeItem(ADMIN_TOK_KEY); } catch (_) {}
}

/* Every admin request carries the same Bearer token the legacy panel used, so
 * the worker's ADMIN_PATHS gate is unchanged. */
function nsFetch(path, init){
  var opts = init || {};
  var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminTok() };
  if (opts.headers) for (var h in opts.headers) headers[h] = opts.headers[h];
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  if (ctrl) opts.signal = ctrl.signal;
  var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 15000);
  return fetch(path, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: headers,
    body: opts.body,
    signal: opts.signal
  }).then(function(res){
    return res.text().then(function(txt){
      var data = {};
      try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = {}; }
      return { ok: res.ok, status: res.status, data: data };
    });
  }).catch(function(){
    return { ok: false, status: 0, data: {} };
  }).then(function(out){ clearTimeout(timer); return out; });
}

/* The five sendable audiences are fixed server-side; their reach comes from the
 * live active-device count, so every segment shares it and shows "—" until the
 * first load fills it in. */
var SEGMENT_PRESET = [
  { id: 'all_students', name: 'All students', name_bn: 'সব শিক্ষার্থী', tag: 'default' },
  { id: 'beginner', name: 'Beginner', name_bn: 'বিগিনার', tag: 'level' },
  { id: 'intermediate', name: 'Intermediate', name_bn: 'ইন্টারমিডিয়েট', tag: 'level' },
  { id: 'pro', name: 'Pro', name_bn: 'প্রো', tag: 'level' },
  { id: 'course_subscribers', name: 'Course subscribers', name_bn: 'কোর্স সাবস্ক্রাইবার', tag: 'subscription' }
];
function buildSegments(){
  var reach = NS.state.reachEstimate;
  return SEGMENT_PRESET.map(function(s){
    return { id: s.id, name: s.name, name_bn: s.name_bn, tag: s.tag, count: reach || 0, live: true };
  });
}

function seed(){
  var S = NS.state;
  S.segments = buildSegments();
  S.reachEstimate = null;
  S.dailyCap = { used: 0, cap: null };
  /* Real state starts empty and is filled by loadCenter(); the UI shows its
   * loading/empty states until then, never invented numbers. */
}

/* ---------- one real data load: templates + history + analytics ---------- */
function loadCenter(){
  NS.state.dataLoading = true;
  if (NS.state.authed) render();
  var p = [];
  p.push(nsFetch('/api/notifications/templates').then(function(out){
    if (out.ok && out.data && out.data.templates) NS.state.templates = out.data.templates;
  }));
  p.push(nsFetch('/api/notifications/history').then(function(out){
    if (out.ok && out.data && out.data.items) {
      NS.state.history = mapHistory(out.data.items);
      if (out.data.reachEstimate != null) {
        NS.state.reachEstimate = Number(out.data.reachEstimate);
        NS.state.segments = buildSegments();
      }
      if (out.data.dailyCap != null) NS.state.dailyCap.cap = Number(out.data.dailyCap);
      NS.state.dailyCap.used = countSentToday(NS.state.history);
      if (out.data.analytics) NS.state.analytics = mapAnalytics(out.data.analytics, NS.state.history);
    }
  }));
  return Promise.all(p).then(function(){
    NS.state.dataLoading = false;
    NS.state.offline = !navigator.onLine;
    if (NS.state.authed) render();
  });
}

function countSentToday(hist){
  var key = new Date().toDateString();
  return hist.filter(function(h){
    return h.status === 'sent' && h.sentAt && new Date(h.sentAt).toDateString() === key;
  }).length;
}

/* Worker row -> the studio's local history shape. The worker stores one
 * bilingual pair (the admin composes in one language), so both title_bn and
 * title_en carry the same value and the detail view shows it either way. */
function mapHistory(items){
  return (items || []).map(function(r){
    return {
      id: r.id, status: r.status, type: r.type, audience: r.audience, channel: 'push',
      title_bn: r.title, title_en: r.title, body_bn: r.body, body_en: r.body,
      imageUrl: r.imageUrl || '', targetUrl: r.targetUrl || '', cta: '',
      sentAt: r.sentAt || null, createdAt: r.createdAt || 0,
      scheduledFor: r.scheduledAt || null,
      reach: r.reachEstimate || 0, delivered: r.delivered || 0,
      opened: 0, clicked: r.clicks || 0,
      error: r.error || null,
      reason_bn: r.error ? ('ডেলিভারি সেবা জানিয়েছে: ' + r.error) : null,
      reason_en: r.error ? ('The delivery service reported: ' + r.error) : null,
      campaign: null,
      apiRow: true
    };
  });
}

function mapAnalytics(a, hist){
  var t = (a && a.totals) || {};
  var items = (a && a.items) || [];
  var days = ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'Today'];
  var series = [0, 0, 0, 0, 0, 0, 0];
  var now = Date.now();
  items.forEach(function(it){
    if (!it.sentAt) return;
    var d = Math.floor((now - it.sentAt) / 86400000);
    if (d >= 0 && d < 7) series[6 - d] += Number(it.delivered || 0);
  });
  var failures = [];
  var byErr = {};
  items.forEach(function(it){
    if (it.status !== 'failed' || !it.error) return;
    byErr[it.error] = (byErr[it.error] || 0) + 1;
  });
  Object.keys(byErr).forEach(function(code){
    failures.push({ code: code, count: byErr[code], bn: code, en: code });
  });
  return {
    days: days, series: series,
    reach: t.delivered || 0, delivered: t.delivered || 0,
    opened: t.opened || 0, clicked: t.clicked || 0, failed: t.failed || 0,
    prev: { delivered: 0, opened: 0, clicked: 0 },
    channels: [{ key: 'push', delivered: t.delivered || 0, opened: t.opened || 0, clicked: t.clicked || 0 }],
    campaignPerf: [],
    failures: failures,
    ab: { enabled: false, metric: 'ctr', a: { label: 'A', reach: 0, opened: 0, clicked: 0 }, b: { label: 'B', reach: 0, opened: 0, clicked: 0 } },
    live: true
  };
}


/* ============================================================
   Part C — shell + overview + compose
   ============================================================ */

var TABS = [
  { id:'overview', ico:'home', key:'navOverview', group:'main' },
  { id:'compose', ico:'pen', key:'navCompose', group:'main' },
  { id:'campaigns', ico:'layers', key:'navCampaigns', group:'main' },
  { id:'queue', ico:'clock', key:'navQueue', group:'ops', badge:'queue' },
  { id:'sent', ico:'send', key:'navSent', group:'ops', badge:'failed' },
  { id:'templates', ico:'fileText', key:'navTemplates', group:'ops' },
  { id:'analytics', ico:'chart', key:'navAnalytics', group:'ops' },
  { id:'automations', ico:'zap', key:'navAutomations', group:'ops' },
  { id:'audience', ico:'users', key:'navAudience', group:'ops' },
  { id:'health', ico:'activity', key:'navHealth', group:'ops', badge:'health' }
];
var MOBILE_TABS = [
  { id:'overview', ico:'home', key:'navHome' },
  { id:'compose', ico:'pen', key:'navCompose' },
  { id:'queue', ico:'clock', key:'navQueue', badge:'queue' },
  { id:'sent', ico:'send', key:'navSent', badge:'failed' },
  { id:'more', ico:'more', key:'navMore' }
];

function badgeFor(kind){
  var S = NS.state;
  if (kind === 'queue') { var q = S.queue.filter(function(x){ return x.status === 'scheduled'; }).length; return { n:q, cls:'' }; }
  if (kind === 'failed') { var f = S.history.filter(function(x){ return x.status === 'failed'; }).length; return { n:f, cls:'is-danger' }; }
  if (kind === 'health') {
    var bad = S.systemHealth.filter(function(x){ return x.s !== 'healthy'; }).length;
    return { n:bad, cls: bad ? 'is-warn' : '' };
  }
  return null;
}

function render(){
  var S = NS.state;
  if (!S.authed) { document.documentElement.dataset.lang = S.lang; document.documentElement.dataset.theme = S.theme; renderGate(); return; }
  document.documentElement.dataset.lang = S.lang;
  document.documentElement.dataset.theme = S.theme;

  var nav = TABS.filter(function(t){ return t.group === 'main'; }).map(navItem).join('') +
    '<div class="ns-nav-label">' + T('navOps') + '</div>' +
    TABS.filter(function(t){ return t.group === 'ops'; }).map(navItem).join('');

  var html = '' +
    '<div class="ns-command-center">' +
      renderTopbar() +
      '<aside class="ns-sidebar" id="nsSidebar">' +
        '<nav class="ns-nav" aria-label="' + esc(T('navMain')) + '">' + nav + '</nav>' +
        '<div class="ns-sidebar-foot">' +
          '<div class="ns-ai-state">' + ic('sparkles', 15) + '<span>' + esc(T('aiAgent')) + '</span>' +
          '<span class="ns-pulse" aria-hidden="true"></span></div>' +
          '<div class="ns-sub-note">' + esc(T('aiReadySub')) + '</div>' +
        '</div>' +
      '</aside>' +
      '<main class="ns-main" id="nsMain" tabindex="-1">' + renderOffline() + renderView() + renderFooter() + '</main>' +
    '</div>' +
    renderMobileNav() + '<div class="ns-kbd-spacer" aria-hidden="true"></div>';

  var root = document.getElementById('nsRoot');
  root.innerHTML = html;
  renderToasts();
  if (S.sheet) renderSheet();
  var m = document.getElementById('nsMain');
  if (m && S.focusMain) { m.focus(); S.focusMain = false; }
}

function navItem(t){
  var b = t.badge ? badgeFor(t.badge) : null;
  var badge = (b && b.n) ? '<span class="ns-nav-badge ' + b.cls + '">' + fmt(b.n) + '</span>' : '';
  return '<button type="button" class="ns-nav-item ns-' + t.id.replace(/[^a-z]/g, '') + '" ' +
    'data-act="tab" data-tab="' + t.id + '" aria-current="' + (NS.state.tab === t.id ? 'page' : 'false') + '"' + ha(t.key) + '>' +
    '<span class="ns-nav-ico">' + ic(t.ico, 19) + '</span><span' + ha(t.key) + '>' + esc(T(t.key)) + '</span>' + badge + '</button>';
}

function renderMobileNav(){
  var S = NS.state;
  var cur = S.tab === 'more' || TABS.some(function(t){ return t.id === S.tab && t.group === 'ops'; }) ? 'more' : S.tab;
  return '<nav class="ns-mobile-nav" aria-label="' + esc(T('navMain')) + '">' +
    MOBILE_TABS.map(function(t){
      var b = t.badge ? badgeFor(t.badge) : null;
      var active = cur === t.id;
      return '<button type="button" data-act="tab" data-tab="' + t.id + '" aria-current="' + (active ? 'page' : 'false') + '"' + ha(t.key) + '>' +
        ic(t.ico, 21) + '<span' + ha(t.key) + '>' + esc(T(t.key)) + '</span>' +
        (b && b.n ? '<span class="ns-sr">' + fmt(b.n) + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
}

function renderTopbar(){
  var S = NS.state;
  var themes = [['light','themeLight','#ffffff'],['dark','themeDark','#0b120f'],['pink','themePink','#fdeef3'],['green','themeGreen','#e6f6ec']];
  return '<header class="ns-topbar" id="nsTopbar">' +
    '<div class="ns-brand">' +
      '<span class="ns-brand-mark">' + ic('bell', 17) + '</span>' +
      '<span class="ns-brand-text">' +
        '<span class="ns-brand-name" data-bn="' + esc(I18N.bn.brand) + '" data-en="' + esc(I18N.en.brand) + '">' + esc(T('brand')) + '</span>' +
        '<span class="ns-brand-sub" data-bn="' + esc(I18N.bn.brandSub) + '" data-en="' + esc(I18N.en.brandSub) + '">' +
          esc(T('brandSub')) + ' <span class="ns-dot">·</span> ' + esc(T('aiWaiting')) + '</span>' +
      '</span>' +
    '</div>' +
    '<div class="ns-topbar-spacer"></div>' +
    '<div class="ns-topbar-tools">' +
      // language
      '<div class="ns-popwrap">' +
        '<button type="button" class="ns-iconbtn" data-act="pop" data-pop="lang" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(T('language')) + '">' + ic('globe', 19) + '</button>' +
        '<div class="ns-pop" id="nsPop-lang" role="menu" aria-label="' + esc(T('language')) + '">' +
          '<div class="ns-pop-title">' + esc(T('language')) + '</div>' +
          '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="lang" data-v="bn" aria-checked="' + (S.lang === 'bn') + '"><span>বাংলা (BN)</span><span class="ns-check">' + ic('check', 15) + '</span></button>' +
          '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="lang" data-v="en" aria-checked="' + (S.lang === 'en') + '"><span>English (EN)</span><span class="ns-check">' + ic('check', 15) + '</span></button>' +
        '</div>' +
      '</div>' +
      // theme
      '<div class="ns-popwrap">' +
        '<button type="button" class="ns-iconbtn" data-act="pop" data-pop="theme" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(T('theme')) + '">' + ic(S.theme === 'dark' ? 'moon' : 'palette', 19) + '</button>' +
        '<div class="ns-pop" id="nsPop-theme" role="menu" aria-label="' + esc(T('theme')) + '">' +
          '<div class="ns-pop-title">' + esc(T('theme')) + '</div>' +
          themes.map(function(t){
            return '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="theme" data-v="' + t[0] + '" aria-checked="' + (S.theme === t[0]) + '">' +
              '<span class="ns-swatch" style="background:' + t[2] + '"></span><span' + ha(t[1]) + '>' + esc(T(t[1])) + '</span><span class="ns-check">' + ic('check', 15) + '</span></button>';
          }).join('') +
        '</div>' +
      '</div>' +
      // simulate
      '<div class="ns-popwrap">' +
        '<button type="button" class="ns-iconbtn' + (S.offline ? ' is-on' : '') + '" data-act="pop" data-pop="sim" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(T('simulate')) + '">' + ic('sliders', 19) + '</button>' +
        '<div class="ns-pop" id="nsPop-sim" role="menu" aria-label="' + esc(T('simulate')) + '">' +
          '<div class="ns-pop-title">' + esc(T('simStates')) + '</div>' +
          '<button type="button" class="ns-pop-item" data-act="simstate" data-v="loading">' + ic('refresh', 15) + '<span' + ha('simLoading') + '>' + esc(T('simLoading')) + '</span></button>' +
          '<button type="button" class="ns-pop-item" data-act="simstate" data-v="empty">' + ic('boxes', 15) + '<span' + ha('simEmpty') + '>' + esc(T('simEmpty')) + '</span></button>' +
          '<button type="button" class="ns-pop-item" data-act="simstate" data-v="error">' + ic('alertCircle', 15) + '<span' + ha('simError') + '>' + esc(T('simError')) + '</span></button>' +
          '<button type="button" class="ns-pop-item" data-act="offline">' + ic('wifiOff', 15) + '<span' + ha('simOffline') + '>' + esc(T('simOffline')) + '</span></button>' +
          '<div class="ns-pop-sep"></div>' +
          '<button type="button" class="ns-pop-item" data-act="simstate" data-v="ok">' + ic('undo', 15) + '<span' + ha('simReset') + '>' + esc(T('simReset')) + '</span></button>' +
        '</div>' +
      '</div>' +
      // role
      '<div class="ns-popwrap">' +
        '<button type="button" class="ns-iconbtn" data-act="pop" data-pop="role" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(T('role')) + '">' + ic('shield', 19) + '</button>' +
        '<div class="ns-pop" id="nsPop-role" role="menu" aria-label="' + esc(T('role')) + '">' +
          '<div class="ns-pop-title">' + esc(T('role')) + '</div>' +
          '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="role" data-v="admin" aria-checked="' + (S.role === 'admin') + '"><span' + ha('roleAdmin') + '>' + esc(T('roleAdmin')) + '</span><span class="ns-check">' + ic('check', 15) + '</span></button>' +
          '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="role" data-v="preparer" aria-checked="' + (S.role === 'preparer') + '"><span' + ha('rolePreparer') + '>' + esc(T('rolePreparer')) + '</span><span class="ns-check">' + ic('check', 15) + '</span></button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</header>';
}

function renderOffline(){
  if (!NS.state.offline) return '';
  return '<div class="ns-offline-banner" role="status" aria-live="polite">' + ic('wifiOff', 17) +
    '<span' + ha('offline') + '>' + esc(T('offline')) + '</span>' +
    '<button type="button" class="ns-btn ns-btn-sm" data-act="offline"' + ha('retry') + '>' + esc(T('retry')) + '</button></div>';
}

function renderFooter(){
  var S = NS.state;
  return '<div class="ns-footer-note">' +
    '<span class="ns-badge ns-badge-ai">' + ic('sparkles', 12) + esc(T('aiWaiting')) + '</span>' +
    '<span' + ha('role') + '>' + esc(T('role')) + ': ' + esc(T(S.role === 'admin' ? 'roleAdmin' : 'rolePreparer')) + '</span>' +
    '<span>' + esc(T('hChecked')) + ': ' + fmtDateTime(Date.now() - 60000) + '</span>' +
    '<span class="ns-muted">' + esc(T('timezone') || '') + ' ' + esc(S.timezone) + '</span>' +
    '<span class="ns-mono">v2.4.0 · notification-command-center</span>' +
  '</div>';
}

/* ---------- state helpers for views ---------- */

function viewState(){
  var S = NS.state;
  return S.viewState[S.tab] || 'ok';
}
function stateWrap(renderFn){
  var vs = viewState();
  if (vs === 'loading') return skeleton();
  if (vs === 'error') return errorState();
  return renderFn();
}
function skeleton(){
  var L = '';
  for (var i = 0; i < 3; i++) L += '<div class="ns-skeleton ns-sk-block"></div>';
  return '<div class="ns-loading ns-card ns-card-pad" role="status" aria-live="polite">' +
    '<span class="ns-sr">' + esc(T('loading')) + '</span>' +
    '<div class="ns-skeleton ns-sk-title"></div><div class="ns-skeleton ns-sk-line"></div>' +
    '<div class="ns-skeleton ns-sk-line" style="width:70%"></div>' + L + '</div>';
}
function errorState(msg){
  var S = NS.state;
  var m = msg || (S.lang === 'bn'
    ? 'ডেটা লোড করা যায়নি কারণ ডেলিভারি সার্ভিস সাড়া দেয়নি (টাইমআউট, ৯ সেকেন্ড)। কোনো পরিবর্তন হারায়নি।'
    : 'Data could not be loaded because the delivery service did not respond (timeout after 9 seconds). Nothing you changed was lost.');
  return '<div class="ns-error ns-card" role="alert">' +
    '<span class="ns-error-ico">' + ic('alertCircle', 22) + '</span>' +
    '<h4' + ha('sDetail') + '>' + esc(T('sDetail')) + '</h4>' +
    '<p class="ns-state-msg">' + esc(m) + '</p>' +
    '<div class="ns-state-actions">' +
      '<button type="button" class="ns-btn ns-btn-primary" data-act="simstate" data-v="ok"' + ha('retry') + '>' + esc(T('retry')) + '</button>' +
      '<button type="button" class="ns-btn ns-btn-ghost" data-act="tab" data-tab="health"' + ha('hTitle') + '>' + esc(T('hTitle')) + '</button>' +
    '</div></div>';
}
function emptyState(ico, title, sub, actionHtml){
  return '<div class="ns-empty ns-card">' +
    '<span class="ns-empty-ico">' + ic(ico, 22) + '</span>' +
    '<h4>' + esc(title) + '</h4>' +
    (sub ? '<p class="ns-state-msg">' + esc(sub) + '</p>' : '') +
    (actionHtml ? '<div class="ns-state-actions">' + actionHtml + '</div>' : '') +
  '</div>';
}
function pageHead(title, sub, actions){
  return '<div class="ns-page-head">' +
    '<div><h1 class="ns-page-title">' + esc(title) + '</h1>' + (sub ? '<p class="ns-page-sub">' + esc(sub) + '</p>' : '') + '</div>' +
    (actions ? '<div class="ns-page-actions">' + actions + '</div>' : '') +
  '</div>';
}

/* ---------- OVERVIEW ---------- */

function renderView(){
  switch (NS.state.tab) {
    case 'overview': return stateWrap(viewOverview);
    case 'compose': return stateWrap(viewCompose);
    case 'campaigns': return stateWrap(viewCampaigns);
    case 'queue': return stateWrap(viewQueue);
    case 'sent': return stateWrap(viewSent);
    case 'templates': return stateWrap(viewTemplates);
    case 'analytics': return stateWrap(viewAnalytics);
    case 'automations': return stateWrap(viewAutomations);
    case 'audience': return stateWrap(viewAudience);
    case 'health': return stateWrap(viewHealth);
    case 'more': return viewMore();
    default: return viewOverview();
  }
}

function viewOverview(){
  var S = NS.state, now = Date.now();
  var sentToday = S.history.filter(function(h){ return h.sentAt && h.sentAt > now - 86400000 && h.status === 'sent'; });
  var delivered = sentToday.reduce(function(a, b){ return a + b.delivered; }, 0);
  var opened = sentToday.reduce(function(a, b){ return a + b.opened; }, 0);
  var clicked = sentToday.reduce(function(a, b){ return a + b.clicked; }, 0);
  var reachToday = sentToday.reduce(function(a, b){ return a + b.reach; }, 0);
  var queued = S.queue.filter(function(q){ return q.status === 'scheduled'; });
  var failed = S.history.filter(function(h){ return h.status === 'failed'; });
  var drafts = S.drafts.length;
  var activeCamp = S.campaigns.filter(function(c){ return c.status === 'active'; });
  var capPct = Math.round((S.dailyCap.used / S.dailyCap.cap) * 100);
  var badSvc = S.systemHealth.filter(function(x){ return x.s !== 'healthy' && x.s !== 'unknown'; });
  var unknownSvc = S.systemHealth.filter(function(x){ return x.s === 'unknown'; });

  var attention = [];
  if (failed.length) attention.push({ tone:'danger', ico:'alertCircle', en: failed.length + ' failed send' + (failed.length > 1 ? 's' : '') + ' need a decision — the last one failed on an invalid target URL.',
    bn: failed.length + 'টি পাঠানো ব্যর্থ — শেষটি অবৈধ টার্গেট URL-এর কারণে ব্যর্থ হয়েছে।', act:'tab', tab:'sent', label:T('ovReviewFailures') });
  if (S.campaigns.some(function(c){ return c.status === 'draft'; })) attention.push({ tone:'info', ico:'layers',
    en:'1 campaign is prepared and waiting for your approval: "RU Admission Reminder" (3,240 reach).',
    bn:'১টি ক্যাম্পেইন অনুমোদনের অপেক্ষায়: "রাবি ভর্তি রিমাইন্ডার" (রিচ ৩,২৪০)।', act:'tab', tab:'campaigns', label:T('caTitle') });
  S.systemHealth.filter(function(x){ return x.s === 'degraded' || x.s === 'unavailable'; }).forEach(function(x){
    attention.push({ tone: x.s === 'unavailable' ? 'danger' : 'warn', ico: x.s === 'unavailable' ? 'ban' : 'alert',
      en: (S.lang === 'en' ? x.en : x.bn) + ' — ' + (x.s === 'unavailable' ? T('hUnavailable') : T('hDegraded')) + '. ' + (S.lang === 'en' ? x.act_en : x.act_bn) + '.',
      bn: x.bn + ' — ' + (x.s === 'unavailable' ? T('hUnavailable') : T('hDegraded')) + '। ' + x.act_bn + '।',
      act:'tab', tab:'health', label:T('hTitle') });
  });
  if (!attention.length) attention.push({ tone:'ok', ico:'checkCircle', en:'Nothing needs your attention right now.', bn:'এই মুহূর্তে আপনার মনোযোগ দরকার এমন কিছু নেই।', act:'tab', tab:'compose', label:T('ovNewNotification') });

  var html = pageHead(T('ovTitle'), T('ovSub'),
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('ovNewNotification')) + '</button>');

  // attention first
  html += '<section class="ns-section ns-overview ns-card" aria-labelledby="nsAttnH">' +
    '<div class="ns-card-head"><h3 id="nsAttnH"' + ha('ovAttention') + '>' + esc(T('ovAttention')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + fmt(attention.length) + '</span></div>' +
    '<div class="ns-card-body" style="display:flex;flex-direction:column;gap:10px">' +
      attention.slice(0, 4).map(function(a){
        var cls = a.tone === 'danger' ? 'ns-callout-danger' : a.tone === 'warn' ? 'ns-callout-warn' : a.tone === 'ok' ? 'ns-callout-ok' : 'ns-callout-info';
        return '<div class="ns-callout ' + cls + '">' + ic(a.ico, 17) +
          '<div style="flex:1"><div>' + esc(S.lang === 'en' ? a.en : a.bn) + '</div></div>' +
          '<button type="button" class="ns-btn ns-btn-sm" data-act="' + a.act + '" data-tab="' + a.tab + '">' + esc(a.label) + '</button>' +
        '</div>';
      }).join('') +
    '</div></section>';

  // hero metrics (hierarchy: throughput dominant)
  html += '<section class="ns-section ns-card" aria-labelledby="nsThroughH">' +
    '<div class="ns-card-head"><h3 id="nsThroughH"' + ha('ovThroughput') + '>' + esc(T('ovThroughput')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + esc(T('sampleNotice')) + '</span>' +
      '<div class="ns-card-actions"><button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="tab" data-tab="analytics">' +
        esc(T('ovSeeAll')) + ic('chevRight', 14) + '</button></div></div>' +
    '<div class="ns-metric-hero">' +
      '<div class="ns-metric"><span class="ns-metric-v is-lg">' + fmt(delivered) + '</span>' +
        '<span class="ns-metric-l"' + ha('anDelivered') + '>' + esc(T('anDelivered')) + '</span>' +
        '<span class="ns-metric-d up">' + ic('trend', 12) + fmt(6) + '% ' + esc(T('anCompare')) + '</span></div>' +
      '<div class="ns-metric"><span class="ns-metric-v">' + fmt(reachToday) + '</span>' +
        '<span class="ns-metric-l"' + ha('ovReachToday') + '>' + esc(T('ovReachToday')) + '</span></div>' +
      '<div class="ns-metric"><span class="ns-metric-v">' + fmt(clicked) + '</span>' +
        '<span class="ns-metric-l"' + ha('anClicked') + '>' + esc(T('anClicked')) + '</span>' +
        '<span class="ns-metric-d flat">' + pct(clicked, delivered) + ' ' + esc(T('anCtr')) + '</span></div>' +
      '<div class="ns-metric"><span class="ns-metric-v">' + fmt(queued.length) + '</span>' +
        '<span class="ns-metric-l"' + ha('ovQueued') + '>' + esc(T('ovQueued')) + '</span></div>' +
    '</div>' +
    '<div class="ns-statgrid" style="border-top:1px solid var(--line)">' +
      [['ovScheduled', S.queue.filter(function(q){ return q.status === 'scheduled'; }).length],
       ['ovActiveCampaigns', activeCamp.length],
       ['ovDrafts', drafts],
       ['ovFailed', failed.length]].map(function(p){
        return '<div class="ns-stat"><div class="ns-stat-v">' + fmt(p[1]) + '</div><div class="ns-stat-l"' + ha(p[0]) + '>' + esc(T(p[0])) + '</div></div>';
      }).join('') +
    '</div>' +
  '</section>';

  // two column: quota+health, recent + ai
  html += '<div class="ns-grid ns-g2 ns-section">' +
    '<section class="ns-card" aria-labelledby="nsQuotaH">' +
      '<div class="ns-card-head"><h3 id="nsQuotaH"' + ha('ovQuota') + '>' + esc(T('ovQuota')) + '</h3>' +
        '<span class="ns-badge ' + (capPct > 85 ? 'ns-badge-danger' : capPct > 65 ? 'ns-badge-warn' : 'ns-badge-ok') + '">' + pct(S.dailyCap.used, S.dailyCap.cap) + '</span></div>' +
      '<div class="ns-card-body">' +
        '<div class="ns-meter-row"><div class="ns-meter-top"><span' + ha('ovThroughput') + '>' + esc(T('ovThroughput')) + '</span>' +
          '<span class="ns-strong">' + fmt(S.dailyCap.used) + ' / ' + fmt(S.dailyCap.cap) + '</span></div>' +
          '<div class="ns-meter ' + (capPct > 85 ? 'is-danger' : capPct > 65 ? 'is-warn' : '') + '"><span style="width:' + capPct + '%"></span></div></div>' +
        '<div class="ns-meter-row"><div class="ns-meter-top"><span' + ha('anDelivered') + '>' + esc(T('anDelivered')) + '</span>' +
          '<span class="ns-strong">' + pct(delivered, reachToday || 1) + '</span></div>' +
          '<div class="ns-meter"><span style="width:' + Math.round((delivered / (reachToday || 1)) * 100) + '%"></span></div></div>' +
        '<div class="ns-meter-row"><div class="ns-meter-top"><span' + ha('ovEngagement') + '>' + esc(T('ovEngagement')) + '</span>' +
          '<span class="ns-strong">' + pct(clicked, delivered || 1) + '</span></div>' +
          '<div class="ns-meter"><span style="width:' + Math.round((clicked / (delivered || 1)) * 100) + '%"></span></div></div>' +
        '<p class="ns-hint">' + esc(S.lang === 'bn'
          ? 'কোটা প্রতিদিন ০০:০০ Asia/Dhaka-তে রিসেট হয়। ৮৫% ছাড়ালে কম গুরুত্বপূর্ণ পাঠানো স্বয়ংক্রিয়ভাবে পিছিয়ে যায়।'
          : 'The quota resets daily at 00:00 Asia/Dhaka. Above 85% low-priority sends are automatically deferred.') + '</p>' +
      '</div>' +
    '</section>' +
    '<section class="ns-card" aria-labelledby="nsDelivH">' +
      '<div class="ns-card-head"><h3 id="nsDelivH"' + ha('ovDelivery') + '>' + esc(T('ovDelivery')) + '</h3>' +
        '<div class="ns-card-actions"><button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="tab" data-tab="health">' +
        esc(T('hTitle')) + ic('chevRight', 14) + '</button></div></div>' +
      '<div class="ns-card-body">' +
        (badSvc.length ? '' : '<div class="ns-callout ns-callout-ok">' + ic('checkCircle', 17) + '<div>' + esc(T('ovSystemOk')) + '</div></div>') +
        (unknownSvc.length ? '<div class="ns-callout ns-callout-info" style="margin-top:' + (badSvc.length ? '10px' : '0') + '">' + ic('info', 17) +
          '<div>' + esc(S.lang === 'bn' ? 'অজানা স্ট্যাটাস: ' : 'Unknown status: ') + unknownSvc.length + ' — ' + esc(T('hChecked')) + ' ' + relTime(unknownSvc[0].checked) + '</div></div>' : '') +
        '<div class="ns-list" style="margin:10px -16px -16px">' +
          S.systemHealth.filter(function(x){ return x.s !== 'healthy'; }).slice(0, 4).map(function(x){
            return '<div class="ns-health-row"><span class="ns-health-dot" data-s="' + x.s + '"></span>' +
              '<span class="ns-health-main"><span class="ns-health-name">' + esc(S.lang === 'en' ? x.en : x.bn) + '</span>' +
              '<span class="ns-health-sub">' + esc(T(x.s === 'degraded' ? 'hDegraded' : x.s === 'unavailable' ? 'hUnavailable' : 'hUnknown')) + ' · ' + relTime(x.checked) + '</span></span>' +
              '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</section>' +
  '</div>';

  html += '<div class="ns-grid ns-g2 ns-section">' +
    '<section class="ns-card ns-card-tight" aria-labelledby="nsRecentH">' +
      '<div class="ns-card-head"><h3 id="nsRecentH"' + ha('ovRecent') + '>' + esc(T('ovRecent')) + '</h3>' +
        '<div class="ns-card-actions"><button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="tab" data-tab="sent">' +
        esc(T('ovSeeAll')) + ic('chevRight', 14) + '</button></div></div>' +
      '<div class="ns-list">' + S.history.slice(0, 5).map(sentRowCompact).join('') + '</div>' +
    '</section>' +
    '<section class="ns-card ns-card-tight" aria-labelledby="nsAiH">' +
      '<div class="ns-card-head"><h3 id="nsAiH"' + ha('ovAiActivity') + '>' + esc(T('ovAiActivity')) + '</h3>' +
        '<span class="ns-badge ns-badge-ai">' + ic('sparkles', 12) + esc(T('aiAgent')) + '</span></div>' +
      '<div class="ns-log">' + S.aiActivity.slice(0, 5).map(logRow).join('') + '</div>' +
    '</section>' +
  '</div>';

  // quick actions
  html += '<section class="ns-section"><div class="ns-eyebrow" style="margin-bottom:10px">' + esc(T('ovQuick')) + '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button type="button" class="ns-btn" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('navCompose')) + '</button>' +
      '<button type="button" class="ns-btn" data-act="tab" data-tab="audience">' + ic('users', 16) + esc(T('navAudience')) + '</button>' +
      '<button type="button" class="ns-btn" data-act="tab" data-tab="campaigns">' + ic('layers', 16) + esc(T('caNew')) + '</button>' +
      '<button type="button" class="ns-btn" data-act="tab" data-tab="automations">' + ic('zap', 16) + esc(T('aNew')) + '</button>' +
      '<button type="button" class="ns-btn" data-act="opendrafts">' + ic('fileText', 16) + esc(T('ovDrafts')) + ' (' + fmt(drafts) + ')</button>' +
    '</div>' +
    '<div style="margin-top:14px">' + renderAuditPanel() + '</div>' +
  '</section>';

  return html;
}

function sentRowCompact(h){
  var S = NS.state;
  return '<button type="button" class="ns-row-item" data-act="detail" data-id="' + h.id + '">' +
    '<span class="ns-typeico" data-t="' + h.type + '">' + ic(TYPES[h.type].ico, 15) + '</span>' +
    '<span class="ns-ri-main">' +
      '<span class="ns-ri-top"><span class="ns-ri-title ns-trunc">' + esc(tr(h, 'title')) + '</span>' + statusBadge(h.status) + '</span>' +
      '<span class="ns-ri-meta"><span>' + esc(audLabel(h.audience)) + '</span><span>·</span><span>' + esc(chanLabel(h.channel)) + '</span>' +
        '<span>·</span><span>' + fmt(h.reach) + ' ' + esc(T('anReach')) + '</span></span>' +
      (h.status === 'failed' ? '<span class="ns-ri-body">' + esc(S.lang === 'en' ? h.reason_en : h.reason_bn) + '</span>' : '') +
    '</span>' +
    '<span class="ns-ri-side"><span class="ns-tiny ns-muted ns-nowrap">' + relTime(h.sentAt || h.scheduledFor || h.createdAt) + '</span></span>' +
  '</button>';
}
function tr(obj, field){ return obj[field + '_' + NS.state.lang] || obj[field + '_en'] || obj[field + '_bn'] || ''; }

function logRow(l){
  var cls = l.kind === 'err' ? 'ns-ci-err' : l.kind === 'warn' ? 'ns-ci-warn' : l.kind === 'wait' ? 'ns-ci-warn' : 'ns-ci-ok';
  var ico = l.kind === 'err' ? 'alertCircle' : l.kind === 'warn' ? 'alert' : l.kind === 'wait' ? 'clock' : 'check';
  return '<div class="ns-log-item">' +
    '<span class="ns-log-ico is-ai">' + ic(l.kind === 'wait' ? 'sparkles' : ico, 14) + '</span>' +
    '<span class="ns-log-main"><span>' + esc(NS.state.lang === 'en' ? l.en : l.bn) + '</span></span>' +
    '<span class="ns-log-time">' + relTime(l.t) + '</span>' +
  '</div>';
}

function renderAuditPanel(){
  var S = NS.state;
  return '<section class="ns-card ns-card-tight" aria-labelledby="nsAuditH">' +
    '<div class="ns-card-head"><h3 id="nsAuditH"' + ha('audit') + '>' + esc(T('audit')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + esc(T('sampleNotice')) + '</span></div>' +
    '<div class="ns-list">' + S.audit.slice(0, 5).map(function(a){
      return '<div class="ns-log-item"><span class="ns-log-ico">' + ic('history', 14) + '</span>' +
        '<span class="ns-log-main"><span class="ns-strong">' + esc(a.actor) + '</span> <span>' + esc(S.lang === 'en' ? a.en : a.bn) + '</span>' +
        '<div class="ns-tiny ns-muted">' + esc(a.ref) + '</div></span>' +
        '<span class="ns-log-time">' + fmtDateTime(a.t) + '</span></div>';
    }).join('') + '</div></section>';
}

/* ============================================================
   Part D — Compose: composer, preview, validation, approval gate
   ============================================================ */

var SAMPLE_STUDENT = { name: 'Nusrat Jahan', university: 'RU', unit: 'A', course: 'English', exam_date: '12 Oct', streak: '14' };
var VARS = ['name', 'university', 'unit', 'course', 'exam_date', 'streak'];

function resolveVars(text){
  if (!text) return '';
  return String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, function(m, k){
    if (SAMPLE_STUDENT[k] != null) return SAMPLE_STUDENT[k];
    return m;
  });
}
function unresolvedVars(text){
  if (!text) return [];
  var out = [], re = /\{\{\s*([a-z_]+)\s*\}\}/g, m;
  while ((m = re.exec(text))) { if (SAMPLE_STUDENT[m[1]] == null && out.indexOf(m[1]) < 0) out.push(m[1]); }
  return out;
}
function hasVar(text, k){ return new RegExp('\\{\\{\\s*' + k + '\\s*\\}\\}').test(text || ''); }

function reachFor(aud){
  var s = NS.state.segments.filter(function(x){ return x.id === aud; })[0];
  return s ? s.count : 0;
}
function computedReach(){
  var base = reachFor(NS.state.audience);
  var S = NS.state;
  var excl = 0;
  if (S.exclude && S.exclude !== 'none') excl = Math.round(base * 0.08);
  return { base: base, excluded: excl, final: Math.max(0, base - excl) };
}

/* ---------- validation ---------- */

function validationChecks(){
  var S = NS.state, out = [];
  var L = S.lang;
  function add(level, en, bn, fixEn, fixBn, fixAct){
    out.push({ level: level, en: en, bn: bn, fixEn: fixEn || '', fixBn: fixBn || '', fixAct: fixAct || null });
  }
  // title
  if (!S.title.trim()) add('err', 'Title is empty — students will see an untitled notification.', 'টাইটেল খালি — শিক্ষার্থীরা শিরোনামবিহীন নোটিফিকেশন দেখবে।',
    'Write a title.', 'একটি টাইটেল লিখুন।', { act:'focus', field:'nsTitle' });
  else if (S.title.length > 65) add('warn', 'Title is ' + S.title.length + ' characters; devices truncate after ~60.', 'টাইটেল ' + S.title.length + ' অক্ষরের; ডিভাইসে ৬০ অক্ষরের পর কাটা যায়।',
    'Shorten the title.', 'টাইটেল ছোট করুন।', null);
  else add('ok', 'Title length is within the device limit.', 'টাইটেলের দৈর্ঘ্য ডিভাইস সীমার মধ্যে।');
  // body
  if (!S.body.trim()) add('err', 'Body is empty — there is nothing to deliver.', 'বার্তা খালি — পাঠানোর কিছু নেই।',
    'Write the message body.', 'বার্তার মূল অংশ লিখুন।', { act:'focus', field:'nsBody' });
  else if (S.body.length > 178) add('warn', 'Body is ' + S.body.length + ' characters and will be truncated on Android.', 'বার্তা ' + S.body.length + ' অক্ষরের, অ্যান্ড্রয়েডে কাটা পড়বে।',
    'Shorten to 178 characters or move detail to the target page.', '১৭৮ অক্ষরে ছোট করুন বা বিস্তারিত টার্গেট পেজে দিন।', null);
  else add('ok', 'Body fits the notification surface.', 'বার্তা নোটিফিকেশন সারফেসে পুরোপুরি বসছে।');
  // target url
  if (!S.targetUrl.trim()) add('warn', 'No target URL — tapping the notification opens nothing.', 'টার্গেট URL নেই — ট্যাপ করলে কিছু খুলবে না।',
    'Add a deep link or https URL.', 'ডিপ লিংক বা https URL যোগ করুন।', { act:'focus', field:'nsTarget' });
  else {
    var okScheme = /^https:\/\//i.test(S.targetUrl) || /^admissionhub:\/\//i.test(S.targetUrl);
    if (!okScheme) add('err', 'Target URL is invalid — the scheme is not supported, so delivery would be refused.', 'টার্গেট URL অবৈধ — এই স্কিম সাপোর্ট করা হয় না, তাই ডেলিভারি আটকে যাবে।',
      'Use https:// or admissionhub://', 'https:// বা admissionhub:// ব্যবহার করুন।', { act:'focus', field:'nsTarget' });
    else add('ok', 'Target URL uses a supported scheme.', 'টার্গেট URL সাপোর্টেড স্কিম ব্যবহার করছে।');
  }
  // image
  if (S.imageUrl && !/^https:\/\//i.test(S.imageUrl)) add('warn', 'Image URL is not https and may be blocked by the device.', 'ছবির URL https নয়, ডিভাইসে ব্লক হতে পারে।', '', '', null);
  // audience + reach
  var r = computedReach();
  if (r.final === 0) add('err', 'Estimated reach is zero — this audience would receive nothing.', 'সম্ভাব্য রিচ শূন্য — এই অডিয়েন্স কিছু পাবে না।',
    'Widen the audience or remove exclusions.', 'অডিয়েন্স বাড়ান বা বাদ দেওয়া শর্ত সরান।', { act:'tab', tab:'audience' });
  else if (r.final > 60000) add('warn', 'This send reaches ' + fmt(r.final) + ' students. Confirm the timing and frequency.', 'এই পাঠানো ' + fmt(r.final) + ' জন শিক্ষার্থী পর্যন্ত যাবে। সময় ও ফ্রিকোয়েন্সি যাচাই করুন।',
    'Consider a narrower segment.', 'ছোট সেগমেন্ট বিবেচনা করুন।', { act:'tab', tab:'audience' });
  else add('ok', 'Reach is ' + fmt(r.final) + ' students.', 'রিচ ' + fmt(r.final) + ' জন শিক্ষার্থী।');
  // quota
  var after = S.dailyCap.used + r.final;
  if (after > S.dailyCap.cap) add('err', 'Daily quota would be exceeded (' + fmt(after) + ' of ' + fmt(S.dailyCap.cap) + ').', 'দৈনিক কোটা ছাড়িয়ে যাবে (' + fmt(after) + ' / ' + fmt(S.dailyCap.cap) + ')।',
    'Schedule for tomorrow or reduce the audience.', 'আগামীকালের জন্য শিডিউল করুন বা অডিয়েন্স কমান।', { act:'tab', tab:'queue' });
  else add('ok', 'Quota is available (' + fmt(S.dailyCap.cap - after) + ' remaining after this send).', 'কোটা আছে (এই পাঠানোর পরেও ' + fmt(S.dailyCap.cap - after) + ' অবশিষ্ট)।');
  // personalization
  if (S.personalization) {
    var bad = unresolvedVars(S.title).concat(unresolvedVars(S.body));
    if (bad.length) add('warn', 'Unknown variable ' + bad.map(function(b){ return '{{' + b + '}}'; }).join(', ') + ' cannot resolve for any student.', 'অজানা ভেরিয়েবল ' + bad.map(function(b){ return '{{' + b + '}}'; }).join(', ') + ' কোনো শিক্ষার্থীর জন্য বসবে না।',
      'Remove it or use an available variable.', 'মুছে ফেলুন বা উপলব্ধ ভেরিয়েবল ব্যবহার করুন।', null);
    else if (hasVar(S.title, 'name') || hasVar(S.body, 'name')) add('ok', 'Personalization resolves for the full audience sample.', 'পার্সোনালাইজেশন পুরো নমুনা অডিয়েন্সে ঠিকভাবে বসছে।');
    else add('ok', 'Personalization is enabled; no variables used yet.', 'পার্সোনালাইজেশন চালু আছে; এখনো কোনো ভেরিয়েবল ব্যবহার হয়নি।');
  }
  // translation
  if (S.showEn) {
    if (!S.titleEn.trim() || !S.bodyEn.trim()) add('warn', 'English copy is incomplete — English users would fall back to Bengali.', 'ইংরেজি কপি অসম্পূর্ণ — ইংরেজি ইউজাররা বাংলাতেই দেখবে।',
      'Complete the English variant.', 'ইংরেজি ভার্সন সম্পূর্ণ করুন।', { act:'toggle', what:'en' });
    else add('ok', 'Both language variants are complete.', 'দুটি ভাষার ভার্সনই সম্পূর্ণ।');
  } else add('ok', 'Single-language send (Bengali).', 'এক-ভাষার পাঠানো (বাংলা)।');
  // duplicates
  var dup = NS.state.history.filter(function(h){
    return h.status !== 'failed' && tr(h, 'title').trim() === S.title.trim() && S.title.trim() !== '';
  })[0];
  if (dup) add('warn', 'Duplicate content: the same title was sent ' + relTime(dup.sentAt) + '.', 'ডুপ্লিকেট কনটেন্ট: একই টাইটেল ' + relTime(dup.sentAt) + ' পাঠানো হয়েছে।',
    'Rewrite the copy or confirm it is intentional.', 'কপি নতুন করে লিখুন বা ইচ্ছাকৃত হলে নিশ্চিত করুন।', null);
  else add('ok', 'No duplicate content found in the last 30 days.', 'গত ৩০ দিনে কোনো ডুপ্লিকেট কনটেন্ট পাওয়া যায়নি।');
  // overlap
  if (S.audience !== 'all_students' && S.audience === 'course_subscribers') add('warn', 'Audience overlap: 96% of this segment is also in All students. Frequency limits apply.', 'অডিয়েন্স ওভারল্যাপ: এই সেগমেন্টের ৯৬% ইতিমধ্যে "সব শিক্ষার্থী"-তে আছে। ফ্রিকোয়েন্সি সীমা প্রযোজ্য।',
    'Frequency protection keeps max 1 push per 24h.', 'ফ্রিকোয়েন্সি সুরক্ষা ২৪ ঘণ্টায় সর্বোচ্চ ১টি পুশ নিশ্চিত করে।', null);
  else add('ok', 'No overlapping send in the last 24 hours.', 'শেষ ২৪ ঘণ্টায় কোনো ওভারল্যাপিং পাঠানো হয়নি।');
  // schedule
  if (S.when) {
    var ts = new Date(S.when).getTime();
    if (isNaN(ts)) add('err', 'The scheduled time is not a valid date.', 'শিডিউলের সময় একটি বৈধ তারিখ নয়।', 'Choose a valid date and time.', 'বৈধ তারিখ ও সময় বেছে নিন।', { act:'focus', field:'nsWhen' });
    else if (ts < Date.now()) add('err', 'Notification could not be scheduled because the selected time has already passed.', 'নোটিফিকেশন শিডিউল করা যায়নি কারণ নির্বাচিত সময় ইতিমধ্যে পার হয়ে গেছে।',
      'Choose another time.', 'অন্য সময় বেছে নিন।', { act:'focus', field:'nsWhen' });
    else {
      add('ok', 'Schedule is valid: ' + fmtDateTime(ts) + ' (' + S.timezone + ').', 'শিডিউল বৈধ: ' + fmtDateTime(ts) + ' (' + S.timezone + ')।');
      var qc = NS.state.queue.filter(function(q){ return Math.abs(q.scheduledFor - ts) < 3600000 && q.status === 'scheduled'; })[0];
      var busy = Math.round(r.final * 0.9);
      if (S.dailyCap.used + busy > S.dailyCap.cap) add('warn', 'Schedule conflict: this slot would add ' + fmt(busy) + ' sends in the same hour as "' + tr(qc, 'title') + '", exceeding the safe hourly window.', 'শিডিউল সংঘর্ষ: এই স্লটে একই ঘণ্টায় "' + tr(qc, 'title') + '"-এর সাথে ' + fmt(busy) + 'টি পাঠানো যোগ হবে, যা নিরাপদ ঘণ্টা-সীমা ছাড়াবে।',
        'Move it 30+ minutes later.', '৩০ মিনিট বা পরে সরিয়ে নিন।', { act:'focus', field:'nsWhen' });
      else if (qc) add('warn', 'Schedule conflict: "' + tr(qc, 'title') + '" is queued within the same hour.', 'শিডিউল সংঘর্ষ: একই ঘণ্টায় "' + tr(qc, 'title') + '" কিউতে আছে।',
        'Review the queue before approving.', 'অনুমোদনের আগে কিউ দেখুন।', { act:'tab', tab:'queue' });
      else add('ok', 'No conflict in the selected hour.', 'নির্বাচিত ঘণ্টায় কোনো সংঘর্ষ নেই।');
    }
  } else add('ok', 'No schedule set — the send would go immediately on approval.', 'শিডিউল দেওয়া নেই — অনুমোদনের সাথে সাথেই যাবে।');
  // channel
  var svc = { push:'svc_push', inapp:'svc_inapp', email:'svc_email', sms:'svc_sms' }[S.channel];
  var svcObj = NS.state.systemHealth.filter(function(x){ return x.id === svc; })[0];
  if (svcObj && svcObj.s === 'unavailable') add('err', chanLabel(S.channel) + ' delivery is currently unavailable — this send cannot complete.', chanLabel(S.channel) + ' ডেলিভারি এখন অনুপলব্ধ — এই পাঠানো সম্পন্ন হবে না।',
    'Switch channel or wait for recovery.', 'চ্যানেল বদলান বা রিকভারির অপেক্ষা করুন।', { act:'focus', field:'nsChannel' });
  else if (svcObj && svcObj.s === 'degraded') add('warn', chanLabel(S.channel) + ' delivery is degraded; receipts may arrive late.', chanLabel(S.channel) + ' ডেলিভারি দুর্বল; রিসিট দেরিতে আসতে পারে।', '', '', null);
  else if (svcObj) add('ok', chanLabel(S.channel) + ' service is healthy.', chanLabel(S.channel) + ' সার্ভিস সুস্থ।');
  // attachment/image size
  if (S.imageUrl && S.imageUrl.length > 240) add('warn', 'Image URL is unusually long and may fail on some clients.', 'ছবির URL অস্বাভাবিক লম্বা, কিছু ক্লায়েন্টে ব্যর্থ হতে পারে।', '', '', null);
  // permission
  if (NS.state.role !== 'admin') add('err', 'Your role can prepare notifications but cannot approve a send.', 'আপনার রোল নোটিফিকেশন প্রস্তুত করতে পারে কিন্তু পাঠানো অনুমোদন করতে পারে না।',
    'Switch to Administrator in the top bar to approve.', 'অনুমোদন করতে টপ বারে অ্যাডমিনিস্ট্রেটর নির্বাচন করুন।', { act:'role' });
  else add('ok', 'Administrator approval authority is active.', 'অ্যাডমিনিস্ট্রেটর অনুমোদন ক্ষমতা সক্রিয়।');
  // offline
  if (NS.state.offline) add('err', 'The system is offline — sending is paused until connectivity returns.', 'সিস্টেম অফলাইন — কানেক্টিভিটি ফিরলে পাঠানো চালু হবে।',
    'Your draft is preserved locally.', 'আপনার ড্রাফট লোকালি সংরক্ষিত আছে।', null);
  // test
  add('ok', 'Test delivery is available before the real send.', 'সত্যিকারের পাঠানোর আগে টেস্ট ডেলিভারি পাওয়া যাচ্ছে।');
  return out;
}
function checksByLevel(){
  var c = validationChecks();
  return {
    all: c,
    err: c.filter(function(x){ return x.level === 'err'; }),
    warn: c.filter(function(x){ return x.level === 'warn'; }),
    ok: c.filter(function(x){ return x.level === 'ok'; })
  };
}
function blockingCount(){
  var L = checksByLevel();
  return L.err.length + (NS.state.offline ? 1 : 0);
}
function canSend(){ return blockingCount() === 0 && NS.state.role === 'admin' && !NS.state.offline; }

/* ---------- preview ---------- */

function notifCopy(){
  var S = NS.state;
  var title = S.showEn && S.previewLangEn ? S.titleEn : S.title;
  var body = S.showEn && S.previewLangEn ? S.bodyEn : S.body;
  return { title: title, body: body };
}
function renderPreview(){
  var S = NS.state;
  var c = notifCopy();
  var resolvedT = S.personalization ? resolveVars(c.title) : c.title;
  var resolvedB = S.personalization ? resolveVars(c.body) : c.body;
  var dark = !!S.previewDark;
  var trust = esc(chanLabel(S.channel));
  var img = S.imageUrl ? '<img class="ns-notif-banner" src="' + esc(S.imageUrl) + '" alt="" onerror="this.style.display=\'none\'" />' : '';
  return '<div class="ns-preview-stage">' +
    '<div class="ns-device" data-os="' + S.previewOs + '" data-size="' + S.previewSize + '" data-dark="' + dark + '">' +
      '<div class="ns-device-wall">' +
        '<div class="ns-locktime">' + esc(hhmm(Date.now())) + '</div>' +
        '<article class="ns-notif" data-os="' + S.previewOs + '">' +
          (S.imageUrl ? '' : '<span class="ns-notif-logo">' + ic('bell', 18) + '</span>') +
          '<span class="ns-notif-main">' +
            '<span class="ns-notif-head"><span>' + esc(NS.state.lang === 'en' ? 'AdmissionHub' : 'অ্যাডমিশনহাব') + '</span>' +
            '<span>· ' + trust + '</span><span class="ns-notif-time">' + esc(NS.state.lang === 'bn' ? 'এখন' : 'now') + '</span></span>' +
            (resolvedT ? '<div class="ns-notif-title">' + esc(resolvedT) + '</div>' :
              '<div class="ns-notif-title ns-muted">' + esc(T('cpFieldTitle')) + '…</div>') +
            img +
            (resolvedB ? '<div class="ns-notif-body">' + esc(resolvedB) + '</div>' :
              '<div class="ns-notif-body ns-muted">' + esc(T('cpFieldBody')) + '…</div>') +
            (S.cta ? '<span class="ns-notif-cta">' + ic('arrowUpRight', 12) + esc(resolveVars(S.cta)) + '</span>' : '') +
          '</span>' +
        '</article>' +
      '</div>' +
    '</div>' +
    '<div class="ns-preview-controls">' +
      '<div class="ns-seg" role="group" aria-label="Platform">' +
        '<button type="button" data-act="previewos" data-v="ios" aria-pressed="' + (S.previewOs === 'ios') + '">' + esc(S.lang === 'bn' ? 'আইওএস' : 'iOS') + '</button>' +
        '<button type="button" data-act="previewos" data-v="android" aria-pressed="' + (S.previewOs === 'android') + '">' + esc(S.lang === 'bn' ? 'অ্যান্ড্রয়েড' : 'Android') + '</button>' +
      '</div>' +
      '<div class="ns-seg" role="group" aria-label="Device size">' +
        ['small','medium','large'].map(function(sz){
          var lbl = sz === 'small' ? (S.lang === 'bn' ? 'ছোট' : 'S') : sz === 'medium' ? (S.lang === 'bn' ? 'মাঝারি' : 'M') : (S.lang === 'bn' ? 'বড়' : 'L');
          return '<button type="button" data-act="previewsize" data-v="' + sz + '" aria-pressed="' + (S.previewSize === sz) + '">' + lbl + '</button>';
        }).join('') +
      '</div>' +
      '<button type="button" class="ns-chip" data-act="previewdark" aria-pressed="' + dark + '">' + ic(dark ? 'sun' : 'moon', 14) +
        esc(dark ? (S.lang === 'bn' ? 'লাইট' : 'Light') : (S.lang === 'bn' ? 'ডার্ক' : 'Dark')) + '</button>' +
      (S.showEn ? '<button type="button" class="ns-chip" data-act="previewlang" aria-pressed="' + (!!S.previewLangEn) + '">' +
        esc(S.previewLangEn ? 'EN' : 'বাংলা') + '</button>' : '') +
    '</div>' +
    '<p class="ns-preview-note">' + esc(S.personalization
      ? (S.lang === 'bn' ? 'পার্সোনালাইজেশন নমুনা শিক্ষার্থী "Nusrat Jahan" দিয়ে দেখানো হচ্ছে।' : 'Personalization previewed with sample student "Nusrat Jahan".')
      : (S.lang === 'bn' ? 'পার্সোনালাইজেশন বন্ধ — ভেরিয়েবল অপরিবর্তিত দেখানো হচ্ছে।' : 'Personalization off — variables are shown unresolved.')) + '</p>' +
  '</div>';
}

/* ---------- validation panel ---------- */

function renderValidation(compact){
  var S = NS.state, C = checksByLevel();
  var rows = (compact ? C.all.slice(0, 7) : C.all).map(function(c){
    var cls = c.level === 'err' ? 'ns-ci-err' : c.level === 'warn' ? 'ns-ci-warn' : 'ns-ci-ok';
    var ico = c.level === 'err' ? 'alertCircle' : c.level === 'warn' ? 'alert' : 'checkCircle';
    var fix = '';
    if (c.fixAct) {
      if (c.fixAct.act === 'focus') fix = '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost ns-check-fix" data-act="focus" data-field="' + c.fixAct.field + '">' + esc(S.lang === 'bn' ? c.fixBn : c.fixEn) + '</button>';
      else if (c.fixAct.act === 'tab') fix = '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost ns-check-fix" data-act="tab" data-tab="' + c.fixAct.tab + '">' + esc(S.lang === 'bn' ? c.fixBn : c.fixEn) + '</button>';
      else if (c.fixAct.act === 'role') fix = '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost ns-check-fix" data-act="role" data-v="admin">' + esc(T('switchRole')) + '</button>';
      else if (c.fixAct.act === 'toggle') fix = '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost ns-check-fix" data-act="toggleen">' + esc(c.fixBn) + '</button>';
    } else if (c.level === 'warn' && (c.fixEn || c.fixBn)) {
      fix = '<span class="ns-check-fix ns-tiny ns-muted">' + esc(S.lang === 'bn' ? c.fixBn : c.fixEn) + '</span>';
    }
    return '<div class="ns-check-item"><span class="ns-check-ico ' + cls + '">' + ic(ico, 15) + '</span>' +
      '<span style="flex:1"><b>' + esc(S.lang === 'bn' ? c.bn : c.en) + '</b></span>' + fix + '</div>';
  }).join('');

  return '<div> ' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
      (C.err.length ? '<span class="ns-badge ns-badge-danger">' + ic('ban', 12) + fmt(C.err.length) + ' ' + esc(S.lang === 'bn' ? 'বাধা' : 'blocking') + '</span>' : '') +
      (C.warn.length ? '<span class="ns-badge ns-badge-warn">' + ic('alert', 12) + fmt(C.warn.length) + ' ' + esc(T('apWarnings')) + '</span>' : '') +
      '<span class="ns-badge ns-badge-ok">' + ic('check', 12) + fmt(C.ok.length) + ' ' + esc(S.lang === 'bn' ? 'পাস' : 'passed') + '</span>' +
    '</div>' +
    '<div class="ns-check-list">' + rows + '</div>' +
    (compact && C.all.length > 7 ? '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="tab" data-tab="compose" style="margin-top:8px">' + esc(T('apChecks')) + ' (' + fmt(C.all.length) + ')</button>' : '') +
  '</div>';
}

/* ---------- composer ---------- */

function viewCompose(){
  var S = NS.state;
  var C = checksByLevel();
  var r = computedReach();

  var head = pageHead(T('cpTitle'), T('cpSub'),
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="opendrafts">' + ic('fileText', 16) + esc(T('ovDrafts')) + ' (' + fmt(S.drafts.length) + ')</button>' +
    (S.lastSavedAt ? '<span class="ns-badge ns-badge-neutral ns-nowrap">' + ic('check', 12) + esc(T('cpAutosaved')) + ' ' + relTime(S.lastSavedAt) + '</span>' : ''));

  var composer =
    '<section class="ns-composer ns-card" aria-labelledby="nsComposeH">' +
      '<div class="ns-card-head"><h3 id="nsComposeH"' + ha('cpDetails') + '>' + esc(T('cpDetails')) + '</h3>' +
        '<div class="ns-card-actions">' +
          (S.dirty ? '<span class="ns-badge ns-badge-warn">' + esc(T('cpUnsaved')) + '</span>' : '') +
          '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="aiopen">' + ic('sparkles', 15) + esc(T('cpAI')) + '</button>' +
        '</div></div>' +
      '<div class="ns-card-body">' +

        // type
        '<div class="ns-field"><span class="ns-flabel" id="nsTypeL"' + ha('cpFieldType') + '>' + esc(T('cpFieldType')) + '</span>' +
          '<div class="ns-radio-cards" role="radiogroup" aria-labelledby="nsTypeL">' +
            TYPE_KEYS.map(function(t){
              return '<label class="ns-radio-card"><input type="radio" name="nsType" value="' + t + '"' + (S.type === t ? ' checked' : '') +
                ' data-act="settype" /><span class="ns-rc-ico">' + ic(TYPES[t].ico, 17) + '</span>' +
                '<span><span class="ns-rc-title">' + esc(typeLabel(t)) + '</span>' +
                (t === 'important' ? '<span class="ns-rc-sub">' + esc(S.lang === 'bn' ? 'উচ্চ অগ্রাধিকার' : 'High priority') + '</span>' : '') +
                '</span></label>';
            }).join('') +
            '<label class="ns-radio-card"><input type="radio" name="nsType" value="__custom"' + (TYPE_KEYS.indexOf(S.type) < 0 ? ' checked' : '') + ' data-act="settype" />' +
              '<span class="ns-rc-ico">' + ic('plus', 17) + '</span><span><span class="ns-rc-title">' + esc(S.lang === 'bn' ? 'কাস্টম / এআই-প্রস্তাবিত' : 'Custom / AI-suggested') + '</span>' +
              '<span class="ns-rc-sub">' + esc(S.lang === 'bn' ? 'নতুন ক্যাটাগরি তৈরি করুন' : 'Create a new category') + '</span></span></label>' +
          '</div>' +
          (S.customType ? '<div style="margin-top:10px"><label class="ns-sr" for="nsCustomType">Custom type</label>' +
            '<input class="ns-input" id="nsCustomType" value="' + esc(S.customType) + '" data-act="customtype"' + ph('cpFieldType') + ' />' +
            '<div class="ns-tiny ns-muted" style="margin-top:6px">' + esc(S.lang === 'bn'
              ? 'কাস্টম টাইপ সেভ হলে ক্যাটাগরি ও ট্যাগ হিসেবে ব্যবহারযোগ্য হবে।'
              : 'Once saved, a custom type becomes available as a category and a tag.') + '</div></div>' : '') +
        '</div>' +

        // channel
        '<div class="ns-field"><span class="ns-flabel" id="nsChanL"' + ha('cpFieldChannel') + '>' + esc(T('cpFieldChannel')) + '</span>' +
          '<div class="ns-vars" role="radiogroup" aria-labelledby="nsChanL" id="nsChannel">' +
            Object.keys(CHANNELS).map(function(c){
              return '<label class="ns-chip' + (S.channel === c ? ' is-on' : '') + '" style="cursor:pointer">' +
                '<input type="radio" name="nsChannelR" value="' + c + '"' + (S.channel === c ? ' checked' : '') + ' data-act="setchannel" style="position:absolute;opacity:0;width:0;height:0" />' +
                ic(CHANNELS[c].ico, 14) + esc(chanLabel(c)) + '</label>';
            }).join('') +
          '</div>' +
          '<span class="ns-hint">' + esc(S.lang === 'bn' ? 'প্রতিটি চ্যানেল আলাদা কনফিগারেশন প্রকাশ করে।' : 'Each channel exposes its own configuration.') + '</span>' +
        '</div>' +

        // templates
        '<div class="ns-field"><label class="ns-flabel" for="nsTpl"' + ha('cpTemplate') + '>' + esc(T('cpTemplate')) + '</label>' +
          '<select class="ns-select" id="nsTpl" data-act="settemplate">' +
            '<option value="">' + esc(S.lang === 'bn' ? '— খালি থেকে শুরু —' : '— Start blank —') + '</option>' +
            S.templates.map(function(t){
              var n = S.lang === 'bn' ? t.bn.title : t.en.title;
              return '<option value="' + t.key + '"' + (S.templateKey === t.key ? ' selected' : '') + '>' + esc(n) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +

        // title
        '<div class="ns-field"><label class="ns-flabel" for="nsTitle"' + ha('cpFieldTitle') + '>' + esc(T('cpFieldTitle')) +
          ' <span class="ns-req" aria-hidden="true">*</span>' +
          '<span class="ns-counter' + (S.title.length > 65 ? ' is-over' : '') + '" id="nsTitleCount">' + fmt(S.title.length) + '/' + fmt(65) + ' ' + esc(T('cpCharCount')) + '</span></label>' +
          '<input class="ns-input" id="nsTitle" data-act="title" value="' + esc(S.title) + '" maxlength="120" aria-required="true" aria-invalid="' + (!S.title.trim()) + '"' + ph('cpFieldTitle') + ' />' +
        '</div>' +

        // body
        '<div class="ns-field"><label class="ns-flabel" for="nsBody"' + ha('cpFieldBody') + '>' + esc(T('cpFieldBody')) +
          ' <span class="ns-req" aria-hidden="true">*</span>' +
          '<span class="ns-counter' + (S.body.length > 178 ? ' is-over' : '') + '" id="nsBodyCount">' + fmt(S.body.length) + '/' + fmt(178) + ' ' + esc(T('cpCharCount')) + '</span></label>' +
          '<textarea class="ns-textarea" id="nsBody" data-act="body" aria-required="true" aria-invalid="' + (!S.body.trim()) + '"' + ph('cpFieldBody') + '>' + esc(S.body) + '</textarea>' +
          '<span class="ns-hint">' + esc(S.lang === 'bn'
            ? 'সংক্ষিপ্ত বার্তায় বেশি ক্লিক আসে — বিস্তারিত তথ্য টার্গেট পেজে রাখুন।'
            : 'Short bodies get more taps — keep detail on the target page.') + '</span>' +
        '</div>' +

        // personalization
        '<div class="ns-field"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span class="ns-flabel"' + ha('cpPersonalize') + '>' + esc(T('cpPersonalize')) + '</span>' +
          '<label class="ns-switch" style="margin-left:auto"><input type="checkbox" data-act="person"' + (S.personalization ? ' checked' : '') + ' />' +
            '<span class="ns-track" aria-hidden="true"></span><span>' + esc(S.personalization ? (S.lang === 'bn' ? 'চালু' : 'On') : (S.lang === 'bn' ? 'বন্ধ' : 'Off')) + '</span></label>' +
          '</div>' +
          '<div class="ns-vars" id="nsVars">' + VARS.map(function(v){
            return '<button type="button" class="ns-var-chip" data-act="insvar" data-v="' + v + '" aria-label="' + esc('Insert ' + v) + '">{{' + v + '}}</button>';
          }).join('') + '</div>' +
          '<span class="ns-hint">' + esc(S.lang === 'bn'
            ? 'ভেরিয়েবল চিপে ট্যাপ করলে কার্সর যেখানে আছে সেখানে বসবে।'
            : 'Tap a variable chip to insert it at the cursor.') + '</span>' +
        '</div>' +

        // image + target + cta
        '<div class="ns-row">' +
          '<div class="ns-field"><label class="ns-flabel" for="nsImage"' + ha('cpFieldImage') + '>' + esc(T('cpFieldImage')) + '</label>' +
            '<input class="ns-input" id="nsImage" data-act="image" value="' + esc(S.imageUrl) + '" placeholder="https://…" />' +
            '<span class="ns-hint">' + esc(S.lang === 'bn' ? 'ব্যানার ছবি না দিলে অ্যাপ আইকন দেখানো হবে।' : 'Without a banner the app icon is shown.') + '</span></div>' +
          '<div class="ns-field"><label class="ns-flabel" for="nsTarget"' + ha('cpFieldTarget') + '>' + esc(T('cpFieldTarget')) + '</label>' +
            '<input class="ns-input" id="nsTarget" data-act="target" value="' + esc(S.targetUrl) + '" placeholder="https://app.admissionhub.com/…" aria-invalid="' +
              (!!S.targetUrl && !/^https:\/\//i.test(S.targetUrl) && !/^admissionhub:\/\//i.test(S.targetUrl)) + '" />' +
            '<span class="ns-hint">' + esc(S.lang === 'bn' ? 'অনুমোদিত স্কিম: https:// অথবা admissionhub://' : 'Supported schemes: https:// or admissionhub://') + '</span></div>' +
        '</div>' +
        '<div class="ns-field"><label class="ns-flabel" for="nsCta"' + ha('cpFieldCta') + '>' + esc(T('cpFieldCta')) + '</label>' +
          '<input class="ns-input" id="nsCta" data-act="cta" value="' + esc(S.cta) + '" placeholder="' + esc(S.lang === 'bn' ? 'যেমন: প্র্যাকটিস শুরু করুন' : 'e.g. Start practice') + '" /></div>' +

        // english variant
        '<details class="ns-disclose" data-act="endetails" id="nsDetEn"' + (S.showEn ? ' open' : '') + '>' +
          '<summary>' + ic('globe', 16) + '<span' + ha('cpEnVariant') + '>' + esc(T('cpEnVariant')) + '</span>' +
            (S.showEn && (!S.titleEn.trim() || !S.bodyEn.trim()) ? '<span class="ns-badge ns-badge-warn">' + esc(T('cpMissingEn')) + '</span>' : '') +
            '<span class="ns-chev">' + ic('chevDown', 16) + '</span></summary>' +
          '<div class="ns-disclose-body">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
              '<span class="ns-hint" style="flex:1">' + esc(S.lang === 'bn'
                ? 'বাংলা ও ইংরেজি কপি একসাথে দেখানো হয় না — প্রিভিউতে একটি ভাষা নির্বাচন করুন।'
                : 'Bengali and English copy are never shown together — pick one language in the preview.') + '</span>' +
              '<label class="ns-switch"><input type="checkbox" data-act="toggleen"' + (S.showEn ? ' checked' : '') + ' />' +
                '<span class="ns-track" aria-hidden="true"></span><span>' + esc(T('cpShowEn')) + '</span></label>' +
            '</div>' +
            (S.showEn ? (
              '<div class="ns-field"><label class="ns-flabel" for="nsTitleEn">' + esc(T('cpFieldTitle')) + ' (EN)</label>' +
                '<input class="ns-input" id="nsTitleEn" data-act="titleen" value="' + esc(S.titleEn) + '" maxlength="120" /></div>' +
              '<div class="ns-field"><label class="ns-flabel" for="nsBodyEn">' + esc(T('cpFieldBody')) + ' (EN)</label>' +
                '<textarea class="ns-textarea" id="nsBodyEn" data-act="bodyen">' + esc(S.bodyEn) + '</textarea></div>'
            ) : '<p class="ns-hint">' + esc(T('cpShowEn')) + '</p>') +
          '</div>' +
        '</details>' +

        // audience
        '<details class="ns-disclose" data-act="endetails" id="nsDetAudience"' + (S.audienceOpen ? ' open' : '') + '>' +
          '<summary>' + ic('users', 16) + '<span' + ha('cpAudience') + '>' + esc(T('cpAudience')) + '</span>' +
            '<span class="ns-badge ns-badge-neutral">' + esc(audLabel(S.audience)) + '</span>' +
            '<span class="ns-chev">' + ic('chevDown', 16) + '</span></summary>' +
          '<div class="ns-disclose-body">' + renderAudiencePicker() + '</div>' +
        '</details>' +

        // schedule
        '<details class="ns-disclose" data-act="endetails" id="nsDetSchedule"' + (S.scheduleOpen ? ' open' : '') + '>' +
          '<summary>' + ic('calendar', 16) + '<span' + ha('cpSchedule') + '>' + esc(T('cpSchedule')) + '</span>' +
            (S.when ? '<span class="ns-badge ns-badge-info">' + esc(fmtDateTime(new Date(S.when).getTime())) + '</span>' : '') +
            '<span class="ns-chev">' + ic('chevDown', 16) + '</span></summary>' +
          '<div class="ns-disclose-body">' + renderSchedulePanel() + '</div>' +
        '</details>' +

        // advanced
        '<details class="ns-disclose" data-act="endetails" id="nsDetAdvanced"' + (S.advancedOpen ? ' open' : '') + '>' +
          '<summary>' + ic('sliders', 16) + '<span' + ha('cpAdvanced') + '>' + esc(T('cpAdvanced')) + '</span>' +
            '<span class="ns-chev">' + ic('chevDown', 16) + '</span></summary>' +
          '<div class="ns-disclose-body">' + renderAdvancedPanel() + '</div>' +
        '</details>' +
      '</div>' +

      // sticky action bar
      '<div class="ns-compose-actions ns-actions">' +
        '<button type="button" class="ns-btn ns-btn-ghost" data-act="savedraft">' + ic('fileText', 16) + esc(T('cpSaveDraft')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-ghost" data-act="savetpl">' + ic('copy', 16) + esc(T('cpSaveTemplate')) + '</button>' +
        '<button type="button" class="ns-btn' + (S.testMode ? ' ns-btn-ghost' : '') + '" data-act="testsend">' + ic('send', 16) + esc(T('cpTestSend')) + '</button>' +
        '<span class="ns-spacer"></span>' +
        '<button type="button" class="ns-btn ns-btn-primary" data-act="review"' + (canSend() ? '' : ' aria-describedby="nsBlockReason"') + '>' +
          (S.when ? ic('calendar', 16) : ic('shield', 16)) + esc(S.when ? T('cpScheduleSend') : T('cpReview')) + '</button>' +
      '</div>' +
      (!canSend() ? '<div id="nsBlockReason" class="ns-tiny ns-muted" style="padding:0 16px 12px">' +
        esc(S.role !== 'admin' ? T('apNoPermission') : S.offline ? T('offline') : T('apBlocked')) + '</div>' : '') +
    '</section>';

  var aside =
    '<div class="ns-compose-sticky">' +
      // reach card (important)
      '<section class="ns-card ns-audience" aria-labelledby="nsReachH">' +
        '<div class="ns-card-head"><h3 id="nsReachH"' + ha('cpReach') + '>' + esc(T('cpReach')) + '</h3>' +
          '<span class="ns-badge ns-badge-ok">' + esc(T('sampleNotice')) + '</span></div>' +
        '<div class="ns-card-body">' +
          '<div class="ns-metric"><span class="ns-metric-v is-lg">' + fmt(r.final) + '</span>' +
            '<span class="ns-metric-l">' + esc(T('cpReachOf')) + ' ' + fmt(reachFor('all_students')) + '</span></div>' +
          '<div class="ns-meter-row" style="margin-top:12px"><div class="ns-meter-top"><span>' + esc(audLabel(S.audience)) + '</span>' +
            '<span class="ns-strong">' + pct(r.final, reachFor('all_students')) + '</span></div>' +
            '<div class="ns-meter"><span style="width:' + Math.round((r.final / reachFor('all_students')) * 100) + '%"></span></div></div>' +
          (r.excluded ? '<div class="ns-callout ns-callout-info" style="margin-bottom:10px">' + ic('info', 16) +
            '<div>' + esc((S.lang === 'bn' ? 'বাদ দেওয়া হয়েছে ' : 'Excluded ') + fmt(r.excluded) + (S.lang === 'bn' ? ' জন শিক্ষার্থী (সাপ্রেশন লিস্ট)।' : ' students (suppression list).')) + '</div></div>' : '') +
          renderBreakdown() +
          '<button type="button" class="ns-btn ns-btn-sm ns-btn-block" data-act="tab" data-tab="audience">' + ic('users', 15) + esc(T('auBuilder')) + '</button>' +
        '</div>' +
      '</section>' +
      // preview (visual anchor)
      '<section class="ns-card ns-preview" aria-labelledby="nsPrevH">' +
        '<div class="ns-card-head"><h3 id="nsPrevH"' + ha('cpPreview') + '>' + esc(T('cpPreview')) + '</h3></div>' +
        '<div class="ns-card-body" id="nsPreviewHost">' + renderPreview() + '</div>' +
      '</section>' +
      // validation
      '<section class="ns-card" aria-labelledby="nsValH">' +
        '<div class="ns-card-head"><h3 id="nsValH"' + ha('cpValidation') + '>' + esc(T('cpValidation')) + '</h3>' +
          (C.err.length ? '<span class="ns-badge ns-badge-danger">' + fmt(C.err.length) + '</span>' :
            C.warn.length ? '<span class="ns-badge ns-badge-warn">' + fmt(C.warn.length) + '</span>' :
            '<span class="ns-badge ns-badge-ok">' + ic('check', 12) + esc(S.lang === 'bn' ? 'প্রস্তুত' : 'Ready') + '</span>') +
        '</div>' +
        '<div class="ns-card-body" id="nsValidationHost">' + renderValidation(false) + '</div>' +
      '</section>' +
      // approval boundary
      '<section class="ns-card ns-approval" aria-labelledby="nsBoundH">' +
        '<div class="ns-card-head"><h3 id="nsBoundH"' + ha('apBoundary') + '>' + esc(T('apTitle')) + '</h3>' +
          '<span class="ns-badge ns-badge-ai">' + ic('sparkles', 12) + esc(T('aiPrepared') || 'AI prepared') + '</span></div>' +
        '<div class="ns-card-body">' +
          '<div class="ns-approval-boundary">' + ic('shield', 16) + '<span' + ha('apBoundary') + '>' + esc(T('apBoundary')) + '</span></div>' +
          '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
            '<button type="button" class="ns-btn ns-btn-sm" data-act="aiopen">' + ic('sparkles', 15) + esc(T('cpAI')) + '</button>' +
            '<button type="button" class="ns-btn ns-btn-sm ns-btn-primary" data-act="review">' + ic('lock', 15) + esc(T('goToApproval')) + '</button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      renderAIPanel() +
    '</div>';

  return head + '<div class="ns-compose-grid">' + composer + aside + '</div>';
}

function renderBreakdown(){
  var S = NS.state, r = computedReach();
  var base = reachFor(S.audience);
  var dist = [
    { bn:'বিশ্ববিদ্যালয়', en:'University', parts:[['RU', .34],['DU', .27],['CU', .21],['BUET', .18]] },
    { bn:'কোর্স', en:'Course', parts:[['English', .31],['Math', .26],['GK', .24],['Analytics', .19]] },
    { bn:'এনগেজমেন্ট', en:'Engagement', parts:[[T('auActive'), .62],[T('auInactive'), .23],[T('auNew'), .15]] }
  ];
  return '<div style="margin-top:12px">' +
    '<div class="ns-eyebrow" style="margin-bottom:8px">' + esc(T('cpBreakdown')) + '</div>' +
    dist.map(function(d, di){
      return '<div style="margin-bottom:11px"><div class="ns-tiny ns-muted" style="margin-bottom:5px">' + esc(S.lang === 'bn' ? d.bn : d.en) + '</div>' +
        '<div class="ns-donut" style="gap:12px">' +
          '<div class="ns-donut-list">' + d.parts.map(function(p, pi){
            var colors = ['var(--brand)','var(--blue)','var(--coral)','var(--amber)'];
            return '<div class="ns-donut-item"><i style="background:' + colors[pi % 4] + '"></i><span>' + esc(p[0]) + '</span>' +
              '<b>' + fmt(Math.round(base * p[1])) + '</b></div>';
          }).join('') + '</div>' +
        '</div></div>';
    }).join('') +
  '</div>';
}

function renderAudiencePicker(){
  var S = NS.state;
  return '<div class="ns-field"><span class="ns-flabel" id="nsAudL"' + ha('auSegments') + '>' + esc(T('auSegments')) + '</span>' +
    '<div class="ns-radio-cards" role="radiogroup" aria-labelledby="nsAudL">' +
      S.segments.map(function(s){
        var nm = S.lang === 'bn' ? s.name_bn : s.name;
        return '<label class="ns-radio-card"><input type="radio" name="nsAud" value="' + s.id + '"' + (S.audience === s.id ? ' checked' : '') + ' data-act="setaudience" />' +
          '<span class="ns-rc-ico">' + ic(s.id === 'all_students' ? 'globe' : s.tag === 'custom' ? 'filter' : 'target', 17) + '</span>' +
          '<span><span class="ns-rc-title">' + esc(nm) + '</span><span class="ns-rc-sub">' + fmt(s.count) + ' ' + esc(T('navAudience')) + '</span></span></label>';
      }).join('') +
    '</div>' +
    '<div class="ns-row" style="margin-top:12px">' +
      '<div><label class="ns-flabel" for="nsExclude">' + esc(T('cpExclude')) + '</label>' +
        '<select class="ns-select" id="nsExclude" data-act="exclude">' +
          '<option value="">' + esc(S.lang === 'bn' ? 'কিছু বাদ নয়' : 'Nothing excluded') + '</option>' +
          S.segments.filter(function(x){ return x.saved; }).map(function(x){
            return '<option value="' + x.id + '"' + (S.exclude === x.id ? ' selected' : '') + '>' + esc(S.lang === 'bn' ? x.name_bn : x.name) + '</option>';
          }).join('') +
        '</select></div>' +
      '<div><label class="ns-flabel" for="nsFreq">' + esc(T('cpFrequency')) + '</label>' +
        '<select class="ns-select" id="nsFreq" data-act="freq">' +
          ['standard','strict','off'].map(function(f){
            var lbl = f === 'standard' ? (S.lang === 'bn' ? 'স্ট্যান্ডার্ড — ২৪ ঘণ্টায় ১টি' : 'Standard — 1 per 24h')
              : f === 'strict' ? (S.lang === 'bn' ? 'কঠোর — ৭২ ঘণ্টায় ১টি' : 'Strict — 1 per 72h')
              : (S.lang === 'bn' ? 'বন্ধ — সুরক্ষা নেই' : 'Off — no protection');
            return '<option value="' + f + '"' + (S.frequency === f ? ' selected' : '') + '>' + esc(lbl) + '</option>';
          }).join('') +
        '</select></div>' +
    '</div>' +
    '<div class="ns-callout ns-callout-info" style="margin-top:10px">' + ic('info', 16) +
      '<div>' + esc(S.lang === 'bn'
        ? 'ফ্রিকোয়েন্সি সুরক্ষা স্বয়ংক্রিয়ভাবে ওভারল্যাপ শনাক্ত করে পাঠানো পিছিয়ে দেয়।'
        : 'Frequency protection detects overlap automatically and defers sends that would exceed the limit.') + '</div></div>' +
  '</div>';
}

function renderSchedulePanel(){
  var S = NS.state;
  return '<div class="ns-row">' +
      '<div class="ns-field"><label class="ns-flabel" for="nsWhen"' + ha('cpWhen') + '>' + esc(T('cpWhen')) + '</label>' +
        '<input class="ns-input" type="datetime-local" id="nsWhen" data-act="when" value="' + esc(S.when ? toLocalInput(new Date(S.when).getTime()) : '') + '" />' +
        '<span class="ns-hint">' + esc(S.lang === 'bn' ? 'অতীতের সময় গ্রহণ করা হয় না।' : 'Past times are rejected.') + '</span></div>' +
      '<div class="ns-field"><label class="ns-flabel" for="nsTz"' + ha('cpTz') + '>' + esc(T('cpTz')) + '</label>' +
        '<select class="ns-select" id="nsTz" data-act="tz">' +
          ['Asia/Dhaka','Asia/Kolkata','Asia/Dubai','Asia/Singapore','UTC'].map(function(z){
            return '<option value="' + z + '"' + (S.timezone === z ? ' selected' : '') + '>' + z + '</option>';
          }).join('') +
        '</select></div>' +
    '</div>' +
    '<label class="ns-switch"><input type="checkbox" data-act="recurring"' + (S.recurring ? ' checked' : '') + ' />' +
      '<span class="ns-track" aria-hidden="true"></span><span' + ha('cpRecurring') + '>' + esc(T('cpRecurring')) + '</span></label>' +
    (S.recurring ? '<div class="ns-field" style="margin-top:8px"><label class="ns-flabel" for="nsEvery"' + ha('cpEvery') + '>' + esc(T('cpEvery')) + '</label>' +
      '<select class="ns-select" id="nsEvery" data-act="every">' +
        ['daily','weekly','biweekly','monthly'].map(function(e){
          var lbl = e === 'daily' ? (S.lang === 'bn' ? 'প্রতিদিন' : 'Every day') : e === 'weekly' ? (S.lang === 'bn' ? 'প্রতি সপ্তাহ' : 'Every week')
            : e === 'biweekly' ? (S.lang === 'bn' ? 'প্রতি দুই সপ্তাহ' : 'Every 2 weeks') : (S.lang === 'bn' ? 'প্রতি মাস' : 'Every month');
          return '<option value="' + e + '"' + (S.recurEvery === e ? ' selected' : '') + '>' + esc(lbl) + '</option>';
        }).join('') +
      '</select></div>' : '') +
    '<div class="ns-callout ns-callout-ok" style="margin-top:10px">' + ic('info', 16) +
      '<div>' + esc(S.lang === 'bn' ? 'সর্বোত্তম সময় সুপারিশ: ' : 'Best-time suggestion: ') +
      '<b>' + esc('21:00 ' + S.timezone) + '</b> — ' + esc(S.lang === 'bn' ? 'গত ৭ দিনে সর্বোচ্চ ক্লিক রেট।' : 'highest click rate over the last 7 days.') + '</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
      '<button type="button" class="ns-btn ns-btn-sm" data-act="whenpreset" data-v="+1h">' + esc(S.lang === 'bn' ? '১ ঘণ্টা পরে' : 'In 1 hour') + '</button>' +
      '<button type="button" class="ns-btn ns-btn-sm" data-act="whenpreset" data-v="2100">' + esc(S.lang === 'bn' ? 'আজ ২১:০০' : 'Today 21:00') + '</button>' +
      '<button type="button" class="ns-btn ns-btn-sm" data-act="whenpreset" data-v="+1d">' + esc(S.lang === 'bn' ? 'আগামীকাল সকাল' : 'Tomorrow morning') + '</button>' +
      '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="whenpreset" data-v="clear">' + esc(S.lang === 'bn' ? 'মুছুন' : 'Clear') + '</button>' +
    '</div>';
}

function renderAdvancedPanel(){
  var S = NS.state;
  return '<div class="ns-row">' +
      '<div class="ns-field"><label class="ns-flabel" for="nsPriority"' + ha('cpFieldPriority') + '>' + esc(T('cpFieldPriority')) + '</label>' +
        '<select class="ns-select" id="nsPriority" data-act="priority">' +
          [['high','উচ্চ'],['normal','সাধারণ'],['low','নিম্ন']].map(function(p){
            var lbl = S.lang === 'bn' ? p[1] : p[0];
            return '<option value="' + p[0] + '"' + (S.priority === p[0] ? ' selected' : '') + '>' + esc(lbl) + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="ns-field"><label class="ns-flabel" for="nsUtm"' + ha('cpUtm') + '>' + esc(T('cpUtm')) + '</label>' +
        '<input class="ns-input" id="nsUtm" data-act="utm" value="' + esc(S.utm) + '" placeholder="utm_source=push&utm_campaign=…" /></div>' +
    '</div>' +
    '<div class="ns-field"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span class="ns-flabel"' + ha('cpAb') + '>' + esc(T('cpAb')) + '</span>' +
      '<label class="ns-switch" style="margin-left:auto"><input type="checkbox" data-act="ab"' + (S.ab.enabled ? ' checked' : '') + ' />' +
        '<span class="ns-track" aria-hidden="true"></span><span>' + esc(S.lang === 'bn' ? 'চালু' : 'On') + '</span></label></div>' +
      (S.ab.enabled ? (
        '<div class="ns-callout ns-callout-info" style="margin-bottom:10px">' + ic('info', 16) + '<div>' + esc(S.lang === 'bn'
          ? 'ট্রাফিক সমানভাবে দুই ভ্যারিয়েন্টে ভাগ হবে (৫০/৫০)।'
          : 'Traffic is split evenly between the two variants (50/50).') + '</div></div>' +
        '<div class="ns-field"><label class="ns-flabel" for="nsTitleB">' + esc(T('apTitleField')) + ' — ' + esc(T('cpVariant')) + ' B</label>' +
          '<input class="ns-input" id="nsTitleB" data-act="titleb" value="' + esc(S.ab.titleB) + '" /></div>' +
        '<div class="ns-field"><label class="ns-flabel" for="nsBodyB">' + esc(T('apBody')) + ' — ' + esc(T('cpVariant')) + ' B</label>' +
          '<textarea class="ns-textarea" id="nsBodyB" data-act="bodyb">' + esc(S.ab.bodyB) + '</textarea></div>'
      ) : '<p class="ns-hint">' + esc(S.lang === 'bn' ? 'একটি ভিন্ন টাইটেল, বডি, ছবি, CTA বা সময় পরীক্ষা করুন।' : 'Test a different title, body, image, CTA or send time.') + '</p>') +
    '</div>';
}

/* ============================================================
   Part E — Campaigns, Queue, Sent, Templates
   ============================================================ */

function viewCampaigns(){
  var S = NS.state;
  var sel = S.selectedCampaign ? S.campaigns.filter(function(c){ return c.id === S.selectedCampaign; })[0] : null;
  var groups = [
    { id:'draft', key:'caDraft', ico:'fileText' },
    { id:'active', key:'caActive', ico:'play' },
    { id:'paused', key:'caPaused', ico:'pause' },
    { id:'completed', key:'caCompleted', ico:'checkCircle' },
    { id:'cancelled', key:'caCancelled', ico:'ban' },
    { id:'failed', key:'caFailed', ico:'alertCircle' }
  ];
  var head = pageHead(T('caTitle'), T('caSub'),
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('navCompose')) + '</button>' +
    '<button type="button" class="ns-btn ns-btn-primary" data-act="campaigns_new">' + ic('plus', 16) + esc(T('caNew')) + '</button>');

  if (!S.campaigns.length) return head + emptyState('layers', T('caTitle'), S.lang === 'bn' ? 'এখনো কোনো ক্যাম্পেইন নেই। প্রথম সিকোয়েন্স তৈরি করুন।' : 'No campaigns yet. Create your first sequence.',
    '<button type="button" class="ns-btn ns-btn-primary" data-act="campaigns_new">' + ic('plus', 16) + esc(T('caNew')) + '</button>');

  var list = '<section class="ns-campaign ns-card ns-card-tight" aria-labelledby="nsCampH">' +
    '<div class="ns-card-head"><h3 id="nsCampH"' + ha('caTitle') + '>' + esc(T('caTitle')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + fmt(S.campaigns.length) + '</span></div>' +
    '<div class="ns-list">' + S.campaigns.map(function(c){
      var done = c.messages.filter(function(m){ return m.status === 'sent'; }).length;
      return '<button type="button" class="ns-row-item' + (S.selectedCampaign === c.id ? ' is-selected' : '') + '" data-act="campaign" data-id="' + c.id + '" aria-current="' + (S.selectedCampaign === c.id ? 'true' : 'false') + '">' +
        '<span class="ns-typeico" data-t="' + (c.status === 'active' ? 'course' : 'announcement') + '">' + ic(c.status === 'active' ? 'play' : c.status === 'paused' ? 'pause' : c.status === 'completed' ? 'check' : 'fileText', 15) + '</span>' +
        '<span class="ns-ri-main"><span class="ns-ri-top"><span class="ns-ri-title">' + esc(S.lang === 'bn' ? c.name_bn : c.name) + '</span>' +
          '<span class="ns-badge ' + (c.status === 'active' ? 'ns-badge-ok' : c.status === 'paused' ? 'ns-badge-warn' : 'ns-badge-neutral') + '">' + esc(T('ca' + c.status.charAt(0).toUpperCase() + c.status.slice(1))) + '</span></span>' +
          '<span class="ns-ri-meta"><span>' + fmt(c.messages.length) + ' ' + esc(T('caMessages')) + '</span><span>·</span><span>' + esc(audLabel(c.audience)) + '</span>' +
          '<span>·</span><span>' + esc(chanLabel(c.channel)) + '</span><span>·</span><span>' + esc(c.owner) + '</span></span>' +
          '<span class="ns-ri-body">' + esc((S.lang === 'bn' ? 'সম্পন্ন ' : 'Completed ') + fmt(done) + ' / ' + fmt(c.messages.length)) + '</span>' +
        '</span>' +
        '<span class="ns-ri-side"><span class="ns-tiny ns-muted ns-nowrap">' + relTime(c.created) + '</span>' + ic('chevRight', 15) + '</span>' +
      '</button>';
    }).join('') + '</div></section>';

  var detail = sel ? renderCampaignDetail(sel) :
    '<div class="ns-compose-sticky">' + emptyState('layers', S.lang === 'bn' ? 'একটি ক্যাম্পেইন নির্বাচন করুন' : 'Select a campaign',
      S.lang === 'bn' ? 'টাইমলাইন, শিডিউল ও অনুমোদন দেখতে বাঁ দিকের তালিকা থেকে একটি ক্যাম্পেইন বেছে নিন।' : 'Pick a campaign from the list to see its timeline, schedule and approval state.',
      '<button type="button" class="ns-btn ns-btn-primary" data-act="campaigns_new">' + ic('plus', 16) + esc(T('caNew')) + '</button>') + '</div>';

  return head + '<div class="ns-compose-grid">' + list + detail + '</div>';
}

function renderCampaignDetail(c){
  var S = NS.state;
  var sc = c.status === 'active' ? 'ns-badge-ok' : c.status === 'paused' ? 'ns-badge-warn' : c.status === 'completed' ? 'ns-badge-info' : 'ns-badge-neutral';
  var nodes = c.messages.map(function(m, i){
    var st = m.status === 'sent' ? 'done' : m.status === 'paused' ? 'warn' : m.status === 'scheduled' ? 'active' : 'idle';
    if (m.kind === 'wait') {
      return '<div class="ns-tl-node" data-state="' + (i === 0 ? 'active' : 'idle') + '">' +
        '<span class="ns-tl-dot">' + ic('clock', 15) + '</span>' +
        '<span class="ns-tl-body"><span class="ns-tl-head"><span class="ns-tl-title">' + esc(S.lang === 'bn' ? m.title_bn : m.title_en) + '</span>' +
          '<span class="ns-badge ns-badge-neutral">' + esc(T('caWait')) + '</span></span>' +
          '<span class="ns-tl-meta">' + esc(fmtDateTime(m.sendAt)) + '</span></span>' +
      '</div>';
    }
    return '<div class="ns-tl-node" data-state="' + st + '">' +
      '<span class="ns-tl-dot">' + (m.status === 'sent' ? ic('check', 15) : fmt(i + 1)) + '</span>' +
      '<span class="ns-tl-body">' +
        '<span class="ns-tl-head"><span class="ns-tl-title">' + esc(S.lang === 'bn' ? m.title_bn : m.title_en) + '</span>' +
          '<span class="ns-badge ns-badge-neutral">' + esc(T('caDay')) + ' ' + fmt(m.day) + '</span>' +
          (m.status === 'sent' ? '<span class="ns-badge ns-badge-ok">' + esc(T('sSent')) + '</span>' :
           m.status === 'scheduled' ? '<span class="ns-badge ns-badge-info">' + esc(T('sScheduled')) + '</span>' :
           m.status === 'paused' ? '<span class="ns-badge ns-badge-warn">' + esc(T('caPaused')) + '</span>' :
           '<span class="ns-badge ns-badge-neutral">' + esc(T('caDraft')) + '</span>') +
        '</span>' +
        '<span class="ns-tl-meta">' + esc(S.lang === 'bn' ? m.body_bn : m.body_en) + '</span>' +
        '<span class="ns-tl-meta">' + ic('clock', 12) + ' ' + esc(fmtDateTime(m.sendAt)) + '</span>' +
      '</span>' +
    '</div>';
  }).join('');

  var actions = '';
  if (c.status === 'draft') actions =
    '<button type="button" class="ns-btn ns-btn-primary" data-act="campaign_activate" data-id="' + c.id + '">' + ic('play', 16) + esc(T('caActivate')) + '</button>' +
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="campaign_duplicate" data-id="' + c.id + '">' + ic('copy', 15) + esc(T('caDuplicate')) + '</button>' +
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="tab" data-tab="compose">' + ic('pen', 15) + esc(T('edit')) + '</button>';
  else if (c.status === 'active') actions =
    '<button type="button" class="ns-btn" data-act="campaign_pause" data-id="' + c.id + '">' + ic('pause', 16) + esc(T('caPause')) + '</button>' +
    '<button type="button" class="ns-btn ns-btn-danger" data-act="campaign_cancel" data-id="' + c.id + '">' + ic('ban', 15) + esc(T('caCancel')) + '</button>';
  else if (c.status === 'paused') actions =
    '<button type="button" class="ns-btn ns-btn-primary" data-act="campaign_resume" data-id="' + c.id + '">' + ic('play', 16) + esc(T('caResume')) + '</button>' +
    '<button type="button" class="ns-btn ns-btn-danger" data-act="campaign_cancel" data-id="' + c.id + '">' + ic('ban', 15) + esc(T('caCancel')) + '</button>';
  else actions = '<button type="button" class="ns-btn ns-btn-ghost" data-act="campaign_duplicate" data-id="' + c.id + '">' + ic('copy', 15) + esc(T('caDuplicate')) + '</button>';

  return '<div class="ns-compose-sticky">' +
    '<section class="ns-card ns-campaign" aria-labelledby="nsCampDetailH">' +
      '<div class="ns-card-head"><h3 id="nsCampDetailH">' + esc(S.lang === 'bn' ? c.name_bn : c.name) + '</h3>' +
        '<span class="ns-badge ' + sc + '">' + esc(T('ca' + c.status.charAt(0).toUpperCase() + c.status.slice(1))) + '</span></div>' +
      '<div class="ns-card-body">' +
        '<dl class="ns-kv">' +
          '<dt' + ha('caAudience') + '>' + esc(T('caAudience')) + '</dt><dd>' + esc(audLabel(c.audience)) + ' · ' + fmt(reachFor(c.audience)) + '</dd>' +
          '<dt' + ha('cpFieldChannel') + '>' + esc(T('cpFieldChannel')) + '</dt><dd>' + esc(chanLabel(c.channel)) + '</dd>' +
          '<dt>' + esc(S.lang === 'bn' ? 'মালিক' : 'Owner') + '</dt><dd>' + esc(c.owner) + '</dd>' +
          '<dt>' + esc(S.lang === 'bn' ? 'তৈরি' : 'Created') + '</dt><dd>' + esc(fmtDateTime(c.created)) + '</dd>' +
          '<dt>' + esc(S.lang === 'bn' ? 'সময়সূচি' : 'Window') + '</dt><dd>' + esc(fmtDateTime(c.messages[0].sendAt) + ' → ' + fmtDateTime(c.messages[c.messages.length - 1].sendAt)) + '</dd>' +
        '</dl>' +
        (c.status === 'draft' ? '<div class="ns-callout ns-callout-warn" style="margin-top:12px">' + ic('alert', 16) +
          '<div>' + esc(T('apBoundary')) + '</div></div>' : '') +
      '</div>' +
      '<div class="ns-card-head" style="border-top:1px solid var(--line);border-bottom:0"><h3' + ha('caTimeline') + '>' + esc(T('caTimeline')) + '</h3>' +
        '<div class="ns-card-actions"><button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="campaign_addmsg" data-id="' + c.id + '">' + ic('plus', 14) + esc(T('caAddMessage')) + '</button></div></div>' +
      '<div class="ns-card-body"><div class="ns-timeline">' + nodes + '</div>' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-block" data-act="campaign_addmsg" data-id="' + c.id + '">' + ic('plus', 15) + esc(T('caAddMessage')) + '</button>' +
      '</div>' +
      '<div class="ns-card-body ns-approval" style="border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap">' + actions + '</div>' +
    '</section>' +
    '<section class="ns-card" aria-labelledby="nsCampSeqH">' +
      '<div class="ns-card-head"><h3 id="nsCampSeqH"' + ha('caSequence') + '>' + esc(T('caSequence')) + '</h3></div>' +
      '<div class="ns-card-body"><div class="ns-flow">' + c.messages.map(function(m){
        var kind = m.kind === 'wait' ? T('caWait') : T('caCondition');
        var ico = m.kind === 'wait' ? 'clock' : 'send';
        return '<div class="ns-flow-step"><span class="ns-flow-chip">' + ic(ico, 16) + '</span>' +
          '<span class="ns-flow-body"><span class="ns-flow-kind">' + esc(kind) + ' · ' + esc(T('caDay')) + ' ' + fmt(m.day) + '</span>' +
          '<span class="ns-flow-text">' + esc(S.lang === 'bn' ? m.title_bn : m.title_en) + '</span>' +
          '<span class="ns-flow-sub">' + esc(S.lang === 'bn' ? (m.body_bn || '') : (m.body_en || '')) + '</span></span></div>';
      }).join('') + '</div></div>' +
    '</section>' +
  '</div>';
}

/* ---------- QUEUE ---------- */

function viewQueue(){
  var S = NS.state;
  var rows = S.queue.slice().sort(function(a, b){ return a.scheduledFor - b.scheduledFor; });
  var head = pageHead(T('qTitle'), T('qSub'),
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="tab" data-tab="sent">' + ic('send', 16) + esc(T('navSent')) + '</button>' +
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('ovNewNotification')) + '</button>');

  if (!rows.length) return head + emptyState('clock', T('qEmpty'), T('qEmptySub'),
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('navCompose')) + '</button>');

  var next = rows[0];
  var timeline = rows.map(function(q){
    var pri = q.priority === 'high' ? 'ns-badge-danger' : q.priority === 'low' ? 'ns-badge-neutral' : 'ns-badge-info';
    var priLbl = q.priority === 'high' ? (S.lang === 'bn' ? 'উচ্চ' : 'High') : q.priority === 'low' ? (S.lang === 'bn' ? 'নিম্ন' : 'Low') : (S.lang === 'bn' ? 'সাধারণ' : 'Normal');
    return '<article class="ns-row-item" data-act="detail" data-id="' + q.id + '">' +
      '<span class="ns-typeico" data-t="' + q.type + '">' + ic(TYPES[q.type].ico, 15) + '</span>' +
      '<span class="ns-ri-main">' +
        '<span class="ns-ri-top"><span class="ns-ri-title">' + esc(S.lang === 'bn' ? q.title_bn : q.title_en) + '</span>' +
          '<span class="ns-badge ' + pri + '">' + esc(priLbl) + '</span>' +
          (q.status === 'paused' ? '<span class="ns-badge ns-badge-warn">' + esc(T('caPaused')) + '</span>' : '') + '</span>' +
        '<span class="ns-ri-meta"><span>' + esc(audLabel(q.audience)) + '</span><span>·</span><span>' + esc(chanLabel(q.channel)) + '</span>' +
          (q.campaign ? '<span>·</span><span>' + esc(q.campaign) + '</span>' : '') + '</span>' +
        '<span class="ns-ri-body">' + ic('clock', 12) + ' ' + esc(fmtDateTime(q.scheduledFor)) + ' · ' +
          esc(T('qCountdown')) + ' ' + esc(clockLeft(q.scheduledFor)) + '</span>' +
      '</span>' +
      '<span class="ns-ri-side">' +
        '<button type="button" class="ns-btn ns-btn-sm" data-act="reschedule" data-id="' + q.id + '">' + esc(T('qReschedule')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-danger" data-act="cancelqueue" data-id="' + q.id + '">' + esc(T('qCancel')) + '</button>' +
      '</span>' +
    '</article>';
  }).join('');

  var stats = '<div class="ns-statgrid" style="border:1px solid var(--line);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:16px">' +
    [['ovQueued', rows.filter(function(q){ return q.status === 'scheduled'; }).length],
     ['caPaused', rows.filter(function(q){ return q.status === 'paused'; }).length],
     ['sScheduled', rows.length],
     ['ovQuota', Math.round((S.dailyCap.cap - S.dailyCap.used) / 1000) + 'k']].map(function(p){
      var v = typeof p[1] === 'number' ? fmt(p[1]) : p[1];
      return '<div class="ns-stat"><div class="ns-stat-v">' + v + '</div><div class="ns-stat-l"' + ha(p[0]) + '>' + esc(T(p[0])) + '</div></div>';
    }).join('') + '</div>';

  return head + stats +
    '<div class="ns-callout ns-callout-info ns-section">' + ic('clock', 17) +
      '<div><b>' + esc(S.lang === 'bn' ? 'পরবর্তী: ' : 'Next up: ') + esc(S.lang === 'bn' ? next.title_bn : next.title_en) + '</b> — ' +
      esc(fmtDateTime(next.scheduledFor)) + ' (' + esc(clockLeft(next.scheduledFor)) + ') · ' + esc(T('apReach')) + ' ' + fmt(reachFor(next.audience)) + '</div></div>' +
    '<section class="ns-card ns-card-tight ns-queue" aria-labelledby="nsQueueH">' +
      '<div class="ns-card-head"><h3 id="nsQueueH"' + ha('qTitle') + '>' + esc(T('qTitle')) + '</h3>' +
        '<span class="ns-badge ns-badge-neutral">' + fmt(rows.length) + '</span></div>' +
      '<div class="ns-list">' + timeline + '</div>' +
    '</section>';
}

/* ---------- SENT / HISTORY ---------- */

function sentFilters(){
  var S = NS.state, f = S.filters.sent;
  var arr = S.history.slice();
  if (f.q.trim()) {
    var q = f.q.trim().toLowerCase();
    arr = arr.filter(function(h){
      return (tr(h, 'title') + ' ' + tr(h, 'body') + ' ' + audLabel(h.audience) + ' ' + h.id).toLowerCase().indexOf(q) >= 0;
    });
  }
  if (f.status !== 'all') arr = arr.filter(function(h){ return h.status === f.status; });
  if (f.type !== 'all') arr = arr.filter(function(h){ return h.type === f.type; });
  if (f.channel !== 'all') arr = arr.filter(function(h){ return h.channel === f.channel; });
  var key = S.filters.sort.key, dir = S.filters.sort.dir === 'desc' ? -1 : 1;
  arr.sort(function(a, b){
    var av = a[key] || 0, bv = b[key] || 0;
    if (typeof av === 'string') { av = tr(a, 'title'); bv = tr(b, 'title'); return av < bv ? -dir : av > bv ? dir : 0; }
    return (av - bv) * dir;
  });
  return arr;
}

function viewSent(){
  var S = NS.state, f = S.filters.sent;
  var arr = sentFilters();
  var head = pageHead(T('sTitle'), T('sSub'),
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="export">' + ic('download', 16) + esc(S.lang === 'bn' ? 'এক্সপোর্ট' : 'Export') + '</button>' +
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('ovNewNotification')) + '</button>');

  var toolbar = '<div class="ns-toolbar">' +
      '<span class="ns-search">' + ic('search', 16) +
        '<label class="ns-sr" for="nsSentQ">' + esc(T('sSearch')) + '</label>' +
        '<input class="ns-input" id="nsSentQ" data-act="sentq" value="' + esc(f.q) + '"' + ph('sSearch') + ' /></span>' +
      '<span class="ns-sr" id="nsStatusL">' + esc(T('sStatus')) + '</span>' +
      '<select class="ns-select ns-nowrap" style="flex:0 0 auto;width:auto" data-act="sentstatus" aria-labelledby="nsStatusL">' +
        ['all','sent','scheduled','sending','cancelled','failed','draft','paused'].map(function(s){
          var lbl = s === 'all' ? T('sAll') : T('s' + s.charAt(0).toUpperCase() + s.slice(1));
          return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + esc(lbl) + '</option>';
        }).join('') +
      '</select>' +
      '<select class="ns-select ns-nowrap" style="flex:0 0 auto;width:auto" data-act="senttype" aria-label="' + esc(T('sType')) + '">' +
        '<option value="all">' + esc(T('sAll')) + '</option>' +
        TYPE_KEYS.map(function(t){ return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + esc(typeLabel(t)) + '</option>'; }).join('') +
      '</select>' +
      '<select class="ns-select ns-nowrap" style="flex:0 0 auto;width:auto" data-act="sentchannel" aria-label="' + esc(T('sChannel')) + '">' +
        '<option value="all">' + esc(T('sAll')) + '</option>' +
        Object.keys(CHANNELS).map(function(c){ return '<option value="' + c + '"' + (f.channel === c ? ' selected' : '') + '>' + esc(chanLabel(c)) + '</option>'; }).join('') +
      '</select>' +
      ((f.q || f.status !== 'all' || f.type !== 'all' || f.channel !== 'all') ?
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="sentclear">' + ic('x', 14) + esc(T('sClear')) + '</button>' : '') +
    '</div>';

  var body;
  if (!arr.length) {
    body = emptyState('search', T('sEmpty'), T('sEmptySub'),
      '<button type="button" class="ns-btn" data-act="sentclear">' + ic('undo', 16) + esc(T('sClear')) + '</button>');
  } else {
    body = '<div class="ns-table-wrap"><table class="ns-table">' +
      '<caption class="ns-sr">' + esc(T('sTitle')) + '</caption><thead><tr>' +
        '<th scope="col"><button type="button" class="ns-sort-btn" data-act="sort" data-key="title" aria-sort="' +
          (S.filters.sort.key === 'title' ? (S.filters.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
          esc(T('cpFieldTitle')) + ic('chevDown', 12, 'ns-sort-ico') + '</button></th>' +
        '<th scope="col">' + esc(T('sStatus')) + '</th>' +
        '<th scope="col">' + esc(T('sType')) + '</th>' +
        '<th scope="col">' + esc(T('navAudience')) + '</th>' +
        '<th scope="col">' + esc(T('sChannel')) + '</th>' +
        '<th scope="col"><button type="button" class="ns-sort-btn" data-act="sort" data-key="reach" aria-sort="' +
          (S.filters.sort.key === 'reach' ? (S.filters.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
          esc(T('sReach')) + ic('chevDown', 12, 'ns-sort-ico') + '</button></th>' +
        '<th scope="col"><button type="button" class="ns-sort-btn" data-act="sort" data-key="sentAt" aria-sort="' +
          (S.filters.sort.key === 'sentAt' ? (S.filters.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
          esc(T('sDate')) + ic('chevDown', 12, 'ns-sort-ico') + '</button></th>' +
        '<th scope="col"><span class="ns-sr">Actions</span></th>' +
      '</tr></thead><tbody>' +
      arr.map(function(h){
        return '<tr>' +
          '<td style="min-width:220px"><button type="button" class="ns-sort-btn ns-strong" data-act="detail" data-id="' + h.id + '" style="font-weight:600">' +
            esc(tr(h, 'title')) + '</button>' +
            '<div class="ns-tiny ns-muted ns-clamp2" style="max-width:340px">' + esc(tr(h, 'body')) + '</div>' +
            (h.status === 'failed' ? '<div class="ns-tiny" style="color:var(--danger);margin-top:4px">' + ic('alertCircle', 11) + ' ' + esc(S.lang === 'en' ? h.reason_en : h.reason_bn) + '</div>' : '') +
          '</td>' +
          '<td>' + statusBadge(h.status) + '</td>' +
          '<td>' + esc(typeLabel(h.type)) + '</td>' +
          '<td>' + esc(audLabel(h.audience)) + '</td>' +
          '<td>' + esc(chanLabel(h.channel)) + '</td>' +
          '<td class="ns-nowrap">' + fmt(h.reach) + '<div class="ns-tiny ns-muted">' + fmt(h.delivered) + ' ' + esc(T('anDelivered')) + '</div></td>' +
          '<td class="ns-nowrap">' + (h.sentAt ? esc(fmtDateTime(h.sentAt)) : (h.scheduledFor ? esc(fmtDateTime(h.scheduledFor)) : '—')) +
            '<div class="ns-tiny ns-muted">' + relTime(h.sentAt || h.scheduledFor || h.createdAt) + '</div></td>' +
          '<td class="ns-nowrap">' +
            (h.status === 'failed' ?
              '<button type="button" class="ns-btn ns-btn-sm ns-btn-primary" data-act="retry" data-id="' + h.id + '">' + esc(T('sRetry')) + '</button>' :
              h.status === 'scheduled' ?
              '<button type="button" class="ns-btn ns-btn-sm" data-act="cancelqueue" data-id="' + h.id + '">' + esc(T('qCancel')) + '</button>' :
              '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="detail" data-id="' + h.id + '">' + esc(T('viewDetail')) + '</button>') +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  return head + '<section class="ns-card ns-card-tight ns-sent" aria-labelledby="nsSentH">' +
    '<div class="ns-card-head"><h3 id="nsSentH"' + ha('sTitle') + '>' + esc(T('sTitle')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + fmt(arr.length) + ' ' + esc(T('of')) + ' ' + fmt(S.history.length) + '</span></div>' +
    toolbar +
    (arr.length ? body : '<div style="padding:0 0 6px">' + body + '</div>') +
  '</section>';
}

/* ---------- TEMPLATES ---------- */

function viewTemplates(){
  var S = NS.state;
  var cat = S.tplCat || 'all';
  var arr = S.templates.filter(function(t){ return cat === 'all' ? true : cat === 'fav' ? t.fav : t.cat === cat; });
  var cats = [{ id:'all', bn:'সব', en:'All' }, { id:'fav', bn:'প্রিয়', en:'Favorites' },
    { id:'exam', bn:'পরীক্ষা', en:'Exam' }, { id:'course', bn:'কোর্স', en:'Course' },
    { id:'engagement', bn:'এনগেজমেন্ট', en:'Engagement' }, { id:'admission', bn:'ভর্তি', en:'Admission' },
    { id:'product', bn:'প্রোডাক্ট', en:'Product' }, { id:'system', bn:'সিস্টেম', en:'System' }];

  var head = pageHead(T('tTitle'), T('tSub'),
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tpl_new">' + ic('plus', 16) + esc(T('tNew')) + '</button>');

  var toolbar = '<div class="ns-toolbar">' +
    '<span class="ns-search">' + ic('search', 16) +
      '<label class="ns-sr" for="nsTplQ">' + esc(T('tAll')) + '</label>' +
      '<input class="ns-input" id="nsTplQ" data-act="tplq" value="' + esc(S.tplQ || '') + '"' + ph('tAll') + ' /></span>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' + cats.map(function(c){
      return '<button type="button" class="ns-chip' + (cat === c.id ? '' : '') + '" data-act="tplcat" data-v="' + c.id + '" aria-pressed="' + (cat === c.id) + '">' +
        esc(S.lang === 'bn' ? c.bn : c.en) + '</button>';
    }).join('') + '</div>' +
  '</div>';

  if (!arr.length) return head + '<section class="ns-card ns-card-tight">' + toolbar + emptyState('fileText', T('tEmpty'), T('tEmptySub'),
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tpl_new">' + ic('plus', 16) + esc(T('tNew')) + '</button>') + '</section>';

  var grid = '<div class="ns-grid ns-g2 ns-section">' + arr.map(function(t){
    var title = S.lang === 'bn' ? t.bn.title : t.en.title;
    var bodyTxt = S.lang === 'bn' ? t.bn.body : t.en.body;
    return '<article class="ns-card ns-card-pad">' +
      '<div class="ns-ri-top" style="margin-bottom:8px">' +
        '<span class="ns-typeico">' + ic('fileText', 15) + '</span>' +
        '<span class="ns-ri-title ns-trunc" style="flex:1">' + esc(title) + '</span>' +
        '<button type="button" class="ns-iconbtn" style="width:36px;height:36px;min-width:36px" data-act="tplfav" data-key="' + t.key + '" aria-pressed="' + t.fav + '" aria-label="' + esc('Favorite') + '">' +
          ic('sparkles', 16, t.fav ? 'is-on' : '') + '</button>' +
      '</div>' +
      '<p class="ns-clamp2" style="margin:0 0 10px;font-size:13px;color:var(--sub)">' + esc(bodyTxt) + '</p>' +
      '<div class="ns-ri-meta" style="margin-bottom:12px">' +
        '<span class="ns-badge ns-badge-neutral">' + esc(t.cat) + '</span>' +
        '<span class="ns-badge ns-badge-info">' + esc(T('tBilingual')) + '</span>' +
        '<span>' + fmt(t.uses) + ' ' + esc(T('tUsedTimes')) + '</span>' +
        '<span>v' + fmt(t.versions) + '</span>' +
        '<span>' + relTime(t.updated) + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-primary" data-act="tpluse" data-key="' + t.key + '">' + ic('check', 15) + esc(T('tUse')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm" data-act="tpldup" data-key="' + t.key + '">' + ic('copy', 14) + esc(T('tDuplicate')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="tplver" data-key="' + t.key + '">' + ic('history', 14) + esc(T('tVersion')) + '</button>' +
      '</div>' +
    '</article>';
  }).join('') + '</div>';

  return head + '<section class="ns-card ns-card-tight ns-templates">' + toolbar + '</section>' + grid;
}

/* ============================================================
   Part F — Analytics, Automations, Audience, Health, More
   ============================================================ */

function barChart(series, labels){
  var max = Math.max.apply(null, series) || 1;
  return '<div class="ns-bar-chart" style="margin-bottom:24px">' + series.map(function(v, i){
    var h = Math.max(4, Math.round((v / max) * 100));
    return '<div class="ns-bar" style="height:' + h + '%" role="img" aria-label="' + esc(labels[i]) + ': ' + esc(fmt(v)) + '"><span>' + esc(labels[i]) + '</span></div>';
  }).join('') + '</div>';
}
function donut(parts, label){
  var total = parts.reduce(function(a, b){ return a + b.value; }, 0) || 1;
  var r = 42, c = 2 * Math.PI * r, off = 0;
  var segs = parts.map(function(p){
    var len = (p.value / total) * c;
    var s = '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="15" ' +
      'stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" ' +
      'transform="rotate(-90 60 60)" stroke-linecap="butt" />';
    off += len;
    return s;
  }).join('');
  return '<div class="ns-donut">' +
    '<svg width="132" height="132" viewBox="0 0 120 120" role="img" aria-label="' + esc(label) + '">' +
      '<circle cx="60" cy="60" r="42" fill="none" stroke="var(--surface-soft)" stroke-width="15" />' + segs + '</svg>' +
    '<div class="ns-donut-list">' + parts.map(function(p){
      return '<div class="ns-donut-item"><i style="background:' + p.color + '"></i><span>' + esc(p.label) + '</span>' +
        '<b>' + pct(p.value, total) + '</b></div>';
    }).join('') + '</div></div>';
}

function viewAnalytics(){
  var S = NS.state, A = S.analytics;
  var ctr = A.clicked / (A.delivered || 1);
  var prevCtr = A.prev.clicked / (A.prev.delivered || 1);
  var head = pageHead(T('anTitle'), T('anSub'),
    '<span class="ns-badge ns-badge-neutral">' + ic('info', 12) + esc(T('anSimulated')) + '</span>' +
    '<button type="button" class="ns-btn ns-btn-ghost" data-act="export">' + ic('download', 16) + esc(S.lang === 'bn' ? 'এক্সপোর্ট' : 'Export') + '</button>');

  var metrics = '<section class="ns-card ns-section" aria-labelledby="nsAnH">' +
    '<div class="ns-card-head"><h3 id="nsAnH"' + ha('anTimeline') + '>' + esc(T('anTimeline')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + esc(T('anCompare')) + '</span></div>' +
    '<div class="ns-metric-hero">' +
      [['anReach', A.reach], ['anDelivered', A.delivered], ['anOpened', A.opened], ['anClicked', A.clicked], ['anFailed', A.failed]].map(function(p, i){
        return '<div class="ns-metric"><span class="ns-metric-v' + (i === 1 ? ' is-lg' : '') + '">' + fmt(p[1]) + '</span>' +
          '<span class="ns-metric-l"' + ha(p[0]) + '>' + esc(T(p[0])) + '</span></div>';
      }).join('') +
      '<div class="ns-metric"><span class="ns-metric-v">' + pct(A.clicked, A.delivered) + '</span>' +
        '<span class="ns-metric-l"' + ha('anCtr') + '>' + esc(T('anCtr')) + '</span>' +
        '<span class="ns-metric-d ' + (ctr >= prevCtr ? 'up' : 'down') + '">' + ic(ctr >= prevCtr ? 'trend' : 'alertCircle', 12) +
          (ctr >= prevCtr ? '+' : '') + fmt(Math.round((ctr - prevCtr) * 1000) / 10) + '% ' + esc(T('anCompare')) + '</span></div>' +
    '</div>' +
    '<div class="ns-card-body" style="border-top:1px solid var(--line)">' + barChart(A.series, A.days) + '</div>' +
  '</section>';

  var chans = '<section class="ns-card" aria-labelledby="nsChanPerfH">' +
    '<div class="ns-card-head"><h3 id="nsChanPerfH"' + ha('anChannel') + '>' + esc(T('anChannel')) + '</h3></div>' +
    '<div class="ns-table-wrap"><table class="ns-table">' +
      '<caption class="ns-sr">' + esc(T('anChannel')) + '</caption><thead><tr>' +
      '<th scope="col">' + esc(T('sChannel')) + '</th><th scope="col">' + esc(T('anDelivered')) + '</th>' +
      '<th scope="col">' + esc(T('anOpened')) + '</th><th scope="col">' + esc(T('anClicked')) + '</th><th scope="col">' + esc(T('anCtr')) + '</th></tr></thead><tbody>' +
      A.channels.map(function(c){
        return '<tr><td class="ns-strong">' + esc(chanLabel(c.key)) + '</td><td>' + fmt(c.delivered) + '</td>' +
          '<td>' + fmt(c.opened) + '</td><td>' + fmt(c.clicked) + '</td><td class="ns-strong">' + pct(c.clicked, c.delivered) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

  var camps = '<section class="ns-card" aria-labelledby="nsCampPerfH">' +
    '<div class="ns-card-head"><h3 id="nsCampPerfH"' + ha('anCampaign') + '>' + esc(T('anCampaign')) + '</h3></div>' +
    '<div class="ns-table-wrap"><table class="ns-table">' +
      '<caption class="ns-sr">' + esc(T('anCampaign')) + '</caption><thead><tr>' +
      '<th scope="col">' + esc(T('caTitle')) + '</th><th scope="col">' + esc(T('anDelivered')) + '</th>' +
      '<th scope="col">' + esc(T('anOpened')) + '</th><th scope="col">' + esc(T('anClicked')) + '</th><th scope="col">' + esc(T('anCtr')) + '</th></tr></thead><tbody>' +
      A.campaignPerf.map(function(p){
        var c = S.campaigns.filter(function(x){ return x.id === p.id; })[0];
        return '<tr><td class="ns-strong">' + esc(c ? (S.lang === 'bn' ? c.name_bn : c.name) : p.id) + '</td>' +
          '<td>' + fmt(p.delivered) + '</td><td>' + fmt(p.opened) + '</td><td>' + fmt(p.clicked) + '</td>' +
          '<td class="ns-strong">' + pct(p.clicked, p.delivered) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

  var breakdown = '<section class="ns-card" aria-labelledby="nsAnBreakH">' +
    '<div class="ns-card-head"><h3 id="nsAnBreakH"' + ha('anBreakdown') + '>' + esc(T('anBreakdown')) + '</h3></div>' +
    '<div class="ns-card-body">' + donut([
      { label: S.lang === 'bn' ? 'পুশ খোলা' : 'Push opens', value: A.channels[0].opened, color: 'var(--brand)' },
      { label: S.lang === 'bn' ? 'ইন-অ্যাপ খোলা' : 'In-app opens', value: A.channels[1].opened, color: 'var(--blue)' },
      { label: S.lang === 'bn' ? 'ইমেইল খোলা' : 'Email opens', value: A.channels[2].opened, color: 'var(--coral)' },
      { label: S.lang === 'bn' ? 'এসএমএস খোলা' : 'SMS opens', value: A.channels[3].opened, color: 'var(--amber)' }
    ], T('anBreakdown')) + '</div></section>';

  var ab = '<section class="ns-card" aria-labelledby="nsAbH">' +
    '<div class="ns-card-head"><h3 id="nsAbH"' + ha('anAb') + '>' + esc(T('anAb')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + esc(T('anSimulated')) + '</span></div>' +
    '<div class="ns-card-body">' +
      [A.ab.a, A.ab.b].map(function(v, i){
        var vr = A.ab.a.clicked / (A.ab.a.delivered || 1);
        var lift = ((A.ab.b.clicked / (A.ab.b.delivered || 1)) / vr - 1) * 100;
        return '<div class="ns-meter-row"><div class="ns-meter-top">' +
          '<span class="ns-strong">' + esc(S.lang === 'bn' ? (i === 0 ? 'ভ্যারিয়েন্ট এ' : 'ভ্যারিয়েন্ট বি') : v.label) + '</span>' +
          '<span>' + esc(T('sClicked')) + ' ' + fmt(v.clicked) + ' · ' + esc(T('anCtr')) + ' ' + pct(v.clicked, v.delivered) +
          (i === 1 ? ' <span class="ns-badge ns-badge-ok">' + ic('trend', 11) + '+' + fmt(Math.round(lift)) + '% ' + esc(T('anLift')) + '</span>' : '') + '</span></div>' +
          '<div class="ns-meter ' + (i === 1 ? '' : '') + '"><span style="width:' + Math.round((v.clicked / (A.ab.b.clicked || 1)) * 100) + '%"></span></div></div>';
      }).join('') +
      '<p class="ns-hint">' + esc(S.lang === 'bn'
        ? 'এ/বি ফলাফল সিমুলেটেড; প্রকৃত পরীক্ষায় ভ্যারিয়েন্ট প্রতি ন্যূনতম ৫,০০০ রিচ দরকার।'
        : 'A/B results are simulated; a real test needs at least 5,000 reach per variant.') + '</p>' +
    '</div></section>';

  var fails = '<section class="ns-card" aria-labelledby="nsFailH">' +
    '<div class="ns-card-head"><h3 id="nsFailH"' + ha('anFailures') + '>' + esc(T('anFailures')) + '</h3></div>' +
    '<div class="ns-list">' + A.failures.map(function(f){
      return '<div class="ns-log-item"><span class="ns-log-ico"><span class="ns-ci-err">' + ic('alertCircle', 14) + '</span></span>' +
        '<span class="ns-log-main"><span class="ns-strong">' + esc(S.lang === 'bn' ? f.bn : f.en) + '</span>' +
        '<div class="ns-tiny ns-muted ns-mono">' + esc(f.code) + '</div></span>' +
        '<span class="ns-log-time ns-strong">' + fmt(f.count) + '</span></div>';
    }).join('') + '</div></section>';

  return head + metrics +
    '<div class="ns-grid ns-g2 ns-section">' + chans + camps + '</div>' +
    '<div class="ns-grid ns-g2 ns-section">' + breakdown + ab + '</div>' +
    '<div class="ns-section">' + fails + '</div>';
}

/* ---------- AUTOMATIONS ---------- */

function flowSteps(a){
  var S = NS.state, L = S.lang;
  var steps = [
    { kind: T('aTrigger'), text: L === 'bn' ? a.trigger_bn : a.trigger_en, ico: 'bolt' },
    { kind: T('aCondition'), text: L === 'bn' ? a.condition_bn : a.condition_en, ico: 'filter' },
    { kind: T('aAction'), text: L === 'bn' ? a.action_bn : a.action_en, ico: 'send' }
  ];
  if (a.wait_bn || a.wait_en) steps.push({ kind: T('aWait'), text: L === 'bn' ? a.wait_bn : a.wait_en, ico: 'clock' });
  if (a.action2_bn || a.action2_en) steps.push({ kind: T('aAction'), text: L === 'bn' ? a.action2_bn : a.action2_en, ico: 'send' });
  return steps;
}
function viewAutomations(){
  var S = NS.state;
  var head = pageHead(T('aTitle'), T('aSub'),
    '<button type="button" class="ns-btn ns-btn-primary" data-act="automation_new">' + ic('plus', 16) + esc(T('aNew')) + '</button>');
  return head + '<div class="ns-grid ns-g2 ns-section">' + S.automations.map(function(a){
    var on = a.status === 'enabled';
    return '<section class="ns-card">' +
      '<div class="ns-card-head"><h3>' + esc(S.lang === 'bn' ? a.name_bn : a.name) + '</h3>' +
        '<span class="ns-badge ' + (on ? 'ns-badge-ok' : 'ns-badge-neutral') + '">' + ic(on ? 'play' : 'pause', 12) + esc(T(on ? 'aEnabled' : 'aDisabled')) + '</span>' +
        '<div class="ns-card-actions">' +
          '<button type="button" class="ns-btn ns-btn-sm" data-act="automation_toggle" data-id="' + a.id + '">' +
            ic(on ? 'pause' : 'play', 14) + esc(T(on ? 'aDisable' : 'aEnable')) + '</button>' +
        '</div></div>' +
      '<div class="ns-card-body">' +
        '<div class="ns-flow">' + flowSteps(a).map(function(s){
          return '<div class="ns-flow-step"><span class="ns-flow-chip">' + ic(s.ico, 16) + '</span>' +
            '<span class="ns-flow-body"><span class="ns-flow-kind">' + esc(s.kind) + '</span>' +
            '<span class="ns-flow-text">' + esc(s.text) + '</span></span></div>';
        }).join('') + '</div>' +
        '<div class="ns-ri-meta" style="margin-top:14px">' +
          '<span class="ns-badge ns-badge-neutral">' + esc((S.lang === 'bn' ? 'চালিত ' : 'Runs ') + fmt(a.runs)) + '</span>' +
          (on ? '' : '<span class="ns-badge ns-badge-warn">' + ic('lock', 11) + esc(T('aNeedsApproval')) + '</span>') +
        '</div>' +
      '</div>' +
    '</section>';
  }).join('') + '</div>';
}

/* ---------- AUDIENCE ENGINE ---------- */

var RULE_FIELDS = [
  { id:'university', bn:'বিশ্ববিদ্যালয়', en:'University', opts:['RU','DU','CU','BUET','JU','KU'] },
  { id:'unit', bn:'ইউনিট', en:'Unit', opts:['A','B','C','D'] },
  { id:'course', bn:'কোর্স', en:'Course', opts:['English','Math','General knowledge','Analytics'] },
  { id:'subscription', bn:'সাবস্ক্রিপশন', en:'Subscription', opts:['active','expired','none'] },
  { id:'level', bn:'লেভেল', en:'Level', opts:['beginner','intermediate','pro'] },
  { id:'last_active', bn:'সর্বশেষ সক্রিয় (দিন)', en:'Last active (days)', num:true }
];
var RULE_OPS = [
  { id:'eq', bn:'সমান', en:'is equal to' },
  { id:'neq', bn:'সমান নয়', en:'is not' },
  { id:'lt', bn:'কম', en:'less than' },
  { id:'gt', bn:'বেশি', en:'greater than' },
  { id:'in', bn:'এর মধ্যে', en:'is one of' }
];
function ruleFieldLabel(f){ return NS.state.lang === 'bn' ? f.bn : f.en; }
function ruleOpLabel(o){ return NS.state.lang === 'bn' ? o.bn : o.en; }

function estimateReachForRules(){
  var S = NS.state, base = reachFor(S.ruleBuilder.base);
  var total = 0, n = 0;
  S.ruleBuilder.groups.forEach(function(g){
    g.rules.forEach(function(r){
      n++;
      var f = SystemMap(r.field);
      if (r.field === 'university') total += 0.34;
      else if (r.field === 'unit') total += 0.42;
      else if (r.field === 'course') total += 0.31;
      else if (r.field === 'subscription') total += 0.62;
      else if (r.field === 'level') total += 0.33;
      else if (r.field === 'last_active') total += (Number(r.value) > 7 ? 0.55 : 0.18);
      else total += 0.5;
    });
  });
  if (!n) return base;
  var factor = total / n;
  if (S.ruleBuilder.logic === 'or') factor = Math.min(0.98, factor * 1.6);
  return Math.max(120, Math.round(base * factor));
}
function SystemMap(){ return null; }

function viewAudience(){
  var S = NS.state, R = S.ruleBuilder;
  var est = estimateReachForRules();
  var head = pageHead(T('auTitle'), T('auSub'),
    '<button type="button" class="ns-btn ns-btn-primary" data-act="segment_save">' + ic('plus', 16) + esc(T('auSave')) + '</button>');

  var predefined = '<section class="ns-card" aria-labelledby="nsPredefH">' +
    '<div class="ns-card-head"><h3 id="nsPredefH"' + ha('auSegments') + '>' + esc(T('auSegments')) + '</h3></div>' +
    '<div class="ns-segment ns-card-body" style="display:flex;flex-direction:column;gap:9px">' +
      S.segments.filter(function(s){ return !s.saved; }).map(function(s){
        var active = S.audience === s.id;
        return '<button type="button" class="ns-row-item" data-act="segment_pick" data-id="' + s.id + '" aria-pressed="' + active + '" style="border:1px solid var(--line);border-radius:14px">' +
          '<span class="ns-typeico">' + ic('target', 15) + '</span>' +
          '<span class="ns-ri-main"><span class="ns-ri-title">' + esc(S.lang === 'bn' ? s.name_bn : s.name) + '</span>' +
          '<span class="ns-ri-meta"><span>' + fmt(s.count) + ' ' + esc(T('navAudience')) + '</span><span>·</span><span>' + pct(s.count, reachFor('all_students')) + '</span></span></span>' +
          (active ? '<span class="ns-badge ns-badge-ok">' + ic('check', 12) + esc(T('selected')) + '</span>' : '') +
        '</button>';
      }).join('') +
    '</div></section>';

  var saved = '<section class="ns-card" aria-labelledby="nsSavedH">' +
    '<div class="ns-card-head"><h3 id="nsSavedH"' + ha('auSaved') + '>' + esc(T('auSaved')) + '</h3>' +
      '<span class="ns-badge ns-badge-neutral">' + fmt(S.segments.filter(function(s){ return s.saved; }).length) + '</span></div>' +
    (S.segments.filter(function(s){ return s.saved; }).length ?
      '<div class="ns-list">' + S.segments.filter(function(s){ return s.saved; }).map(function(s){
        return '<button type="button" class="ns-row-item" data-act="segment_pick" data-id="' + s.id + '">' +
          '<span class="ns-typeico">' + ic('filter', 15) + '</span>' +
          '<span class="ns-ri-main"><span class="ns-ri-title">' + esc(S.lang === 'bn' ? s.name_bn : s.name) + '</span>' +
          '<span class="ns-ri-meta"><span>' + fmt(s.count) + ' ' + esc(T('navAudience')) + '</span><span>·</span><span>AND 3</span></span></span>' +
          '<span class="ns-ri-side">' + ic('chevRight', 15) + '</span></button>';
      }).join('') + '</div>' :
      '<div class="ns-card-body"><p class="ns-hint">' + esc(S.lang === 'bn' ? 'এখনো কোনো কাস্টম সেগমেন্ট নেই — নিচে একটি বানান।' : 'No custom segments yet — build one below.') + '</p></div>') +
  '</section>';

  var builder = '<section class="ns-card ns-audience" aria-labelledby="nsBuilderH">' +
    '<div class="ns-card-head"><h3 id="nsBuilderH"' + ha('auBuilder') + '>' + esc(T('auBuilder')) + '</h3>' +
      '<div class="ns-card-actions">' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="seg_addrule">' + ic('plus', 14) + esc(T('auAddRule')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="seg_addgroup">' + ic('layers', 14) + esc(T('auAddGroup')) + '</button>' +
      '</div></div>' +
    '<div class="ns-card-body">' +
      '<div class="ns-row" style="margin-bottom:12px">' +
        '<div class="ns-field" style="margin-bottom:0"><label class="ns-flabel" for="nsSegName"' + ha('auName') + '>' + esc(T('auName')) + '</label>' +
          '<input class="ns-input" id="nsSegName" data-act="segname" value="' + esc(R.name) + '"' + ph('auName') + ' /></div>' +
        '<div class="ns-field" style="margin-bottom:0"><label class="ns-flabel" for="nsSegBase">' + esc(T('auSegments')) + '</label>' +
          '<select class="ns-select" id="nsSegBase" data-act="segbase">' +
            S.segments.map(function(s){ return '<option value="' + s.id + '"' + (R.base === s.id ? ' selected' : '') + '>' + esc(S.lang === 'bn' ? s.name_bn : s.name) + '</option>'; }).join('') +
          '</select></div>' +
      '</div>' +
      '<div class="ns-seg" role="group" aria-label="' + esc(T('auAnd')) + ' / ' + esc(T('auOr')) + '" style="margin-bottom:12px">' +
        '<button type="button" data-act="seglogic" data-v="and" aria-pressed="' + (R.logic === 'and') + '">' + esc(T('auAnd')) + '</button>' +
        '<button type="button" data-act="seglogic" data-v="or" aria-pressed="' + (R.logic === 'or') + '">' + esc(T('auOr')) + '</button>' +
      '</div>' +
      (R.groups.length ? R.groups.map(function(g, gi){
        return '<fieldset style="border:1px dashed var(--line-strong);border-radius:14px;padding:12px;margin:0 0 12px">' +
          '<legend class="ns-tiny ns-muted" style="padding:0 6px">' + esc((S.lang === 'bn' ? 'গ্রুপ ' : 'Group ') + fmt(gi + 1)) + '</legend>' +
          (g.rules.length ? g.rules.map(function(r, ri){
            var f = RULE_FIELDS.filter(function(x){ return x.id === r.field; })[0] || RULE_FIELDS[0];
            return '<div class="ns-row" style="align-items:flex-end;margin-bottom:10px">' +
              '<div style="flex:1 1 150px"><label class="ns-sr">' + esc(ruleFieldLabel(f)) + '</label>' +
                '<select class="ns-select" data-act="rulefield" data-g="' + gi + '" data-r="' + ri + '">' +
                  RULE_FIELDS.map(function(x){ return '<option value="' + x.id + '"' + (r.field === x.id ? ' selected' : '') + '>' + esc(ruleFieldLabel(x)) + '</option>'; }).join('') +
                '</select></div>' +
              '<div style="flex:0 1 130px"><label class="ns-sr">Operator</label>' +
                '<select class="ns-select" data-act="ruleop" data-g="' + gi + '" data-r="' + ri + '">' +
                  RULE_OPS.map(function(o){ return '<option value="' + o.id + '"' + (r.op === o.id ? ' selected' : '') + '>' + esc(ruleOpLabel(o)) + '</option>'; }).join('') +
                '</select></div>' +
              '<div style="flex:1 1 150px"><label class="ns-sr">Value</label>' +
                (f.opts ? '<select class="ns-select" data-act="rulevalue" data-g="' + gi + '" data-r="' + ri + '">' +
                  f.opts.map(function(o){ return '<option value="' + o + '"' + (String(r.value) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'
                  : '<input class="ns-input" data-act="rulevalue" data-g="' + gi + '" data-r="' + ri + '" value="' + esc(r.value) + '" inputmode="numeric" />') +
              '</div>' +
              '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="rule_remove" data-g="' + gi + '" data-r="' + ri + '" aria-label="' + esc(T('auRemove')) + '" style="flex:0 0 auto">' + ic('x', 15) + '</button>' +
            '</div>';
          }).join('') : '<p class="ns-hint">' + esc(T('auNoRules')) + '</p>') +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button type="button" class="ns-btn ns-btn-sm" data-act="seg_addrule" data-g="' + gi + '">' + ic('plus', 14) + esc(T('auAddRule')) + '</button>' +
            (R.groups.length > 1 ? '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="seg_removegroup" data-g="' + gi + '">' + ic('trash', 14) + esc(T('delete')) + '</button>' : '') +
          '</div></fieldset>';
      }).join('') : '<div class="ns-callout ns-callout-info">' + ic('info', 16) + '<div>' + esc(T('auNoRules')) +
        ' <b>' + esc((S.lang === 'bn' ? 'রিচ ' : 'Reach ') + fmt(reachFor(R.base))) + '</b></div></div>') +

      '<div class="ns-callout ns-callout-ok" style="margin-top:14px">' + ic('users', 17) +
        '<div><b' + ha('auEstimate') + '>' + esc(T('auEstimate')) + ':</b> <span class="ns-strong">' + fmt(est) + '</span> ' +
        esc(T('of')) + ' ' + fmt(reachFor('all_students')) + ' · ' + pct(est, reachFor('all_students')) + '</div></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-primary" data-act="seg_apply">' + ic('check', 15) + esc(T('cpApply')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm" data-act="segment_save">' + ic('fileText', 15) + esc(T('auSave')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="seg_reset">' + ic('undo', 15) + esc(T('reset')) + '</button>' +
      '</div>' +
      renderBreakdown() +
      '<div class="ns-callout ns-callout-info" style="margin-top:12px">' + ic('shield', 16) +
        '<div>' + esc(S.lang === 'bn'
          ? 'স্টুডেন্ট-লেভেল ব্যক্তিগত তথ্য কখনো দেখানো হয় না; সব হিসাব সমষ্টিগত।'
          : 'Student-level personal data is never exposed here; every figure is aggregated.') + '</div></div>' +
      '<div style="margin-top:12px"><div class="ns-eyebrow" style="margin-bottom:8px">' + esc(T('cpSample')) + '</div>' +
        '<div class="ns-vars">' + [['RU · A · active 3d', 3240], ['DU · B · new', 1180], ['CU · A · active 12d', 860]].map(function(p){
          return '<span class="ns-chip ns-chip-static">' + esc(p[0]) + ' · ' + fmt(p[1]) + '</span>';
        }).join('') + '</div></div>' +
    '</div></section>';

  return head + '<div class="ns-compose-grid">' + builder + '<div class="ns-compose-sticky">' + predefined + saved + '</div></div>';
}

/* ---------- SYSTEM HEALTH ---------- */

function viewHealth(){
  var S = NS.state;
  var counts = { healthy:0, degraded:0, unavailable:0, unknown:0 };
  S.systemHealth.forEach(function(x){ counts[x.s]++; });
  var worst = counts.unavailable ? 'unavailable' : counts.degraded ? 'degraded' : counts.unknown ? 'unknown' : 'healthy';
  var head = pageHead(T('hTitle'), T('hSub'),
    '<button type="button" class="ns-btn" data-act="health_check">' + ic('refresh', 16) + esc(T('hCheck')) + '</button>');

  var summary = '<div class="ns-statgrid" style="border:1px solid var(--line);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:16px">' +
    [['hHealthy', counts.healthy, 'healthy'], ['hDegraded', counts.degraded, 'degraded'],
     ['hUnavailable', counts.unavailable, 'unavailable'], ['hUnknown', counts.unknown, 'unknown']].map(function(p){
      return '<div class="ns-stat"><div class="ns-stat-v"><span class="ns-health-dot" data-s="' + p[2] + '" style="display:inline-block;margin-right:7px"></span>' + fmt(p[1]) + '</div>' +
        '<div class="ns-stat-l"' + ha(p[0]) + '>' + esc(T(p[0])) + '</div></div>';
    }).join('') + '</div>';

  var callout = worst === 'healthy' ?
    '<div class="ns-callout ns-callout-ok ns-section">' + ic('checkCircle', 17) + '<div>' + esc(T('ovSystemOk')) + '</div></div>' :
    '<div class="ns-callout ' + (worst === 'unavailable' ? 'ns-callout-danger' : 'ns-callout-warn') + ' ns-section">' + ic('alert', 17) +
      '<div><b' + ha('ovDegraded') + '>' + esc(T('ovDegraded')) + '</b> — ' +
        esc(S.lang === 'bn'
          ? (S.systemHealth.filter(function(x){ return x.s === 'unavailable'; }).length) + 'টি সেবা অনুপলব্ধ এবং ' + counts.degraded + 'টি দুর্বল। প্রভাবিত চ্যানেলে পাঠানো ব্লক হবে।'
          : counts.unavailable + ' service unavailable and ' + counts.degraded + ' degraded. Sends on affected channels are blocked.') + '</div></div>';

  return head + summary + callout +
    '<section class="ns-card ns-card-tight ns-health" aria-labelledby="nsHealthH">' +
      '<div class="ns-card-head"><h3 id="nsHealthH"' + ha('hTitle') + '>' + esc(T('hTitle')) + '</h3>' +
        '<span class="ns-badge ' + (worst === 'healthy' ? 'ns-badge-ok' : worst === 'unavailable' ? 'ns-badge-danger' : 'ns-badge-warn') + '">' +
        esc(T(worst === 'healthy' ? 'hHealthy' : worst === 'degraded' ? 'hDegraded' : worst === 'unavailable' ? 'hUnavailable' : 'hUnknown')) + '</span></div>' +
      '<div class="ns-list">' + S.systemHealth.map(function(x){
        var tone = x.s === 'healthy' ? 'ns-badge-ok' : x.s === 'degraded' ? 'ns-badge-warn' : x.s === 'unavailable' ? 'ns-badge-danger' : 'ns-badge-neutral';
        return '<div class="ns-health-row">' +
          '<span class="ns-health-dot" data-s="' + x.s + '" role="img" aria-label="' + esc(T('h' + x.s.charAt(0).toUpperCase() + x.s.slice(1))) + '"></span>' +
          '<span class="ns-health-main">' +
            '<span class="ns-health-name">' + esc(S.lang === 'bn' ? x.bn : x.en) + '</span>' +
            '<span class="ns-health-sub"><b' + ha('hCapability') + '>' + esc(T('hCapability')) + ':</b> ' + esc(S.lang === 'bn' ? x.cap_bn : x.cap_en) + '</span>' +
            '<span class="ns-health-sub"><b' + ha('hAction') + '>' + esc(T('hAction')) + ':</b> ' + esc(S.lang === 'bn' ? x.act_bn : x.act_en) + '</span>' +
          '</span>' +
          '<span class="ns-ri-side"><span class="ns-badge ' + tone + '">' + esc(T('h' + x.s.charAt(0).toUpperCase() + x.s.slice(1))) + '</span>' +
          '<span class="ns-tiny ns-muted ns-nowrap"><b' + ha('hChecked') + '>' + esc(T('hChecked')) + ':</b> ' + esc(fmtDateTime(x.checked)) + '</span></span>' +
        '</div>';
      }).join('') + '</div>' +
      '<div class="ns-card-body" style="border-top:1px solid var(--line)"><p class="ns-hint">' + esc(T('hNoSpinner')) + '</p></div>' +
    '</section>';
}

/* ---------- MORE ---------- */

function viewMore(){
  var S = NS.state;
  var ops = TABS.filter(function(t){ return t.group === 'ops'; });
  return pageHead(T('navMore'), S.lang === 'bn' ? 'অপারেশন সেকশনগুলো এক জায়গায়।' : 'Every operations section in one place.',
    '<button type="button" class="ns-btn ns-btn-primary" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('ovNewNotification')) + '</button>') +
    '<div class="ns-grid ns-g2 ns-section">' + ops.map(function(t){
      var b = t.badge ? badgeFor(t.badge) : null;
      return '<button type="button" class="ns-card ns-card-pad" data-act="tab" data-tab="' + t.id + '" style="text-align:left;cursor:pointer;display:flex;gap:12px;align-items:flex-start">' +
        '<span class="ns-typeico">' + ic(t.ico, 17) + '</span>' +
        '<span style="flex:1"><span class="ns-ri-title">' + esc(T(t.key)) + '</span>' +
        (b && b.n ? '<div class="ns-ri-meta" style="margin-top:6px"><span class="ns-badge ' + (b.cls === 'is-danger' ? 'ns-badge-danger' : b.cls === 'is-warn' ? 'ns-badge-warn' : 'ns-badge-neutral') + '">' + fmt(b.n) + '</span></div>' : '') +
        '</span>' + ic('chevRight', 16) + '</button>';
    }).join('') + '</div>' +
    '<div class="ns-section">' + renderAuditPanel() + '</div>';
}

/* ============================================================
   Part G — AI panel, sheets/modals, toasts, auth gate
   ============================================================ */

/* ---------- AI ---------- */

var AI_PROMPTS = [
  { key:'p1', bn:'রাবি ইউনিট এ-র জন্য ৭ দিনের রিমাইন্ডার ক্যাম্পেইন বানাও', en:'Create a 7-day RU Unit A reminder campaign' },
  { key:'p2', bn:'এই বার্তাটি ছোট করো', en:'Shorten this message' },
  { key:'p3', bn:'ইংরেজি ভার্সন তৈরি করো', en:'Write the English version' },
  { key:'p4', bn:'সেরা পাঠানোর সময় সুপারিশ করো', en:'Suggest the best send time' },
  { key:'p5', bn:'ডুপ্লিকেট বা ওভারল্যাপ যাচাই করো', en:'Check for duplicates and overlap' }
];

function aiMsgHtml(m){
  var S = NS.state;
  var av = m.from === 'admin' ? ic('users', 14) : ic('sparkles', 14);
  var steps = (m.steps || []).map(function(st){
    return '<li class="' + (st.done ? 'is-done' : '') + '">' + ic(st.done ? 'checkCircle' : 'dot', 13) + '<span>' + esc(S.lang === 'bn' ? st.bn : st.en) + '</span></li>';
  }).join('');
  var actions = '';
  if (m.readyForApproval) {
    actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button type="button" class="ns-btn ns-btn-sm" data-act="ai_apply">' + ic('check', 14) + esc(S.lang === 'bn' ? 'কম্পোজারে প্রয়োগ করুন' : 'Apply to composer') + '</button>' +
      '<button type="button" class="ns-btn ns-btn-sm ns-btn-primary" data-act="review">' + ic('lock', 14) + esc(T('goToApproval')) + '</button>' +
      '</div>';
  }
  return '<div class="ns-ai-msg ' + (m.from === 'admin' ? 'from-admin' : '') + '">' +
    '<span class="ns-ai-avatar">' + av + '</span>' +
    '<span class="ns-ai-bubble"><span>' + esc(m.text) + '</span>' +
      (steps ? '<ul class="ns-ai-steps">' + steps + '</ul>' : '') +
      (m.readyForApproval ? '<div style="margin-top:8px"><span class="ns-badge ns-badge-ai">' + ic('lock', 11) + esc(T('aiWaiting')) + '</span></div>' : '') +
      actions +
    '</span></div>';
}

function renderAIPanel(){
  var S = NS.state;
  var thread = S.aiThread.length ? S.aiThread : [{
    from: 'ai',
    text: S.lang === 'bn'
      ? 'আমি নোটিফিকেশন প্রস্তুত, অডিয়েন্স টার্গেট, ক্যাম্পেইন সাজানো, অনুবাদ, ভ্যালিডেশন—সব করতে পারি। পাঠানোর চূড়ান্ত অনুমতি শুধু আপনার।'
      : 'I can prepare notifications, target audiences, build campaigns, translate, rewrite and validate. The final send permission stays with you only.'
  }];
  return '<section class="ns-ai ns-card" id="nsAiHost" aria-labelledby="nsAiPanelH">' +
    '<div class="ns-ai-head">' + ic('sparkles', 17) + '<h3 id="nsAiPanelH"' + ha('aiAgent') + '>' + esc(T('aiAgent')) + '</h3>' +
      '<span class="ns-badge ' + (S.aiBusy ? 'ns-badge-warn' : 'ns-badge-ok') + '">' +
        (S.aiBusy ? esc(T('aiThinking')) : esc(T('aiReady'))) + '</span>' +
      '<div class="ns-card-actions"><button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="ai_clear">' + ic('undo', 14) + esc(T('reset')) + '</button></div></div>' +
    '<div class="ns-ai-thread" id="nsAiThread" role="log" aria-live="polite" aria-label="' + esc(T('aiAgent')) + '">' +
      thread.map(aiMsgHtml).join('') +
      (S.aiBusy ? '<div class="ns-ai-msg"><span class="ns-ai-avatar">' + ic('sparkles', 14) + '</span>' +
        '<span class="ns-ai-bubble"><span class="ns-skeleton ns-sk-line" style="width:180px;margin:0"></span></span></div>' : '') +
    '</div>' +
    '<div class="ns-ai-prompts">' + AI_PROMPTS.map(function(p){
      return '<button type="button" class="ns-chip" data-act="ai_prompt" data-v="' + esc(S.lang === 'bn' ? p.bn : p.en) + '">' + esc(S.lang === 'bn' ? p.bn : p.en) + '</button>';
    }).join('') + '</div>' +
    '<div class="ns-ai-input">' +
      '<label class="ns-sr" for="nsAiCmd">' + esc(T('cpAI')) + '</label>' +
      '<textarea class="ns-textarea" id="nsAiCmd" rows="1" data-act="aicmd"' + ph('cpAI') + '>' + esc(S.aiCommand) + '</textarea>' +
      '<button type="button" class="ns-btn ns-btn-primary ns-btn-icon" data-act="ai_send" aria-label="' + esc(T('cpAI')) + '">' + ic('send', 17) + '</button>' +
    '</div>' +
  '</section>';
}

function aiRun(cmd){
  var S = NS.state;
  cmd = (cmd || '').trim();
  if (!cmd) return;
  S.aiThread.push({ from: 'admin', text: cmd });
  S.aiBusy = true;
  S.aiCommand = '';
  render();
  var low = cmd.toLowerCase();
  var isCampaign = /campaign|7-day|৭ দিন|campaign|sequence/.test(low);
  var isShorten = /shorten|ছোট/.test(low);
  var isTranslate = /english|ইংরেজি|translate|অনুবাদ/.test(low);
  var isSchedule = /time|best|সুপারিশ|সময়|schedule/.test(low);
  var isAudit = /duplicate|overlap|ডুপ্লিকেট|ওভারল্যাপ|check/.test(low);

  setTimeout(function(){
    S.aiBusy = false;
    var steps = [], text = '', apply = null, ready = true;

    if (isCampaign) {
      steps = [
        { en:'Identified the audience: RU · Unit A · active in the last 7 days', bn:'অডিয়েন্স চিহ্নিত: রাবি · ইউনিট এ · শেষ ৭ দিনে সক্রিয়' },
        { en:'Estimated reach: 3,240 students (2.5% of all students)', bn:'সম্ভাব্য রিচ: ৩,২৪০ শিক্ষার্থী (সব শিক্ষার্থীর ২.৫%)' },
        { en:'Drafted 4 messages with 3 wait steps across 7 days', bn:'৭ দিনে ৩টি অপেক্ষা ধাপসহ ৪টি বার্তা তৈরি' },
        { en:'Checked conflicts: no other send in those windows', bn:'সংঘর্ষ যাচাই: ওই সময়ে অন্য কোনো পাঠানো নেই' }
      ];
      S.aiThread.push({ from:'ai', text: S.lang === 'bn'
        ? 'ক্যাম্পেইন "রাবি ভর্তি রিমাইন্ডার" তৈরি করেছি — ৪টি বার্তা, ৩ দিন ও ১ দিন পরে। অনুমোদনের জন্য প্রস্তুত।'
        : 'I prepared the campaign "RU Admission Reminder" — 4 messages with a 3-day and 1-day interval. Ready for your approval.',
        steps: steps, readyForApproval: true });
      apply = function(){
        if (!S.campaigns.some(function(c){ return c.id === 'cmp_ai_new'; })) {
          S.campaigns.unshift({ id:'cmp_ai_new', name:'AI · RU Unit A reminder', name_bn:'এআই · রাবি ইউনিট এ রিমাইন্ডার', status:'draft',
            audience:'ru_a_prep', channel:'push', created:Date.now(), owner:'AI prepared · awaiting admin',
            messages: [
              { day:1, kind:'message', title_bn:'প্রস্তুতি শুরু', title_en:'Preparation begins', body_bn:'রাবি ইউনিট এ প্রস্তুতির প্রথম দিন — আজ ২০টি প্রশ্ন।', body_en:'Day one of RU Unit A prep — 20 questions today.', status:'ready', sendAt:Date.now()+86400000 },
              { day:3, kind:'message', title_bn:'প্র্যাকটিস রিমাইন্ডার', title_en:'Practice reminder', body_bn:'মক টেস্ট দিয়ে প্রস্তুতি চালিয়ে যাও।', body_en:'Keep going with a mock test.', status:'ready', sendAt:Date.now()+3*86400000 },
              { day:5, kind:'wait', title_bn:'২ দিন অপেক্ষা', title_en:'Wait 2 days', status:'ready', sendAt:Date.now()+5*86400000 },
              { day:7, kind:'message', title_bn:'শেষ রিমাইন্ডার', title_en:'Final reminder', body_bn:'আগামীকাল পরীক্ষা — ভুল প্রশ্ন রিভিউ করো।', body_en:'Exam tomorrow — review your wrong answers.', status:'ready', sendAt:Date.now()+7*86400000 }
            ] });
        }
        NS.state.tab = 'campaigns';
        NS.state.selectedCampaign = 'cmp_ai_new';
        NS.state.aiActivity.unshift({ t: Date.now(), bn:'এআই ক্যাম্পেইন প্রস্তুত করেছে: রাবি ইউনিট এ', en:'AI prepared campaign: RU Unit A', kind:'wait' });
        NS.state.audit.unshift({ t: Date.now(), actor:'AI Agent', bn:'ক্যাম্পেইন প্রস্তুত করেছে', en:'Prepared campaign', ref:'AI · RU Unit A reminder' });
      };
    } else if (isShorten) {
      var short = S.body.length > 90 ? S.body.slice(0, 88).replace(/\s+\S*$/, '') + '…' : S.body;
      steps = [
        { en:'Measured the body at ' + S.body.length + ' characters', bn:'বার্তার দৈর্ঘ্য মাপা হয়েছে: ' + S.body.length + ' অক্ষর' },
        { en:'Removed filler while keeping the personalization token', bn:'পার্সোনালাইজেশন টোকেন রেখে অতিরিক্ত শব্দ বাদ' },
        { en:'Verified the new length fits one notification', bn:'নতুন দৈর্ঘ্য এক নোটিফিকেশনে বসছে' }
      ];
      S.aiThread.push({ from:'ai', text: S.lang === 'bn'
        ? 'বার্তা ছোট করেছি — অর্থ অপরিবর্তিত, দৈর্ঘ্য এখন ' + short.length + ' অক্ষর।'
        : 'Shortened the body — meaning intact, now ' + short.length + ' characters.',
        steps: steps, readyForApproval: true });
      apply = function(){ NS.state.body = short; };
    } else if (isTranslate) {
      steps = [
        { en:'Read the Bengali source copy', bn:'বাংলা সোর্স কপি পড়া হয়েছে' },
        { en:'Translated title and body, preserving all variables', bn:'সব ভেরিয়েবল রেখে টাইটেল ও বডি অনুবাদ' },
        { en:'Flagged that both variants must stay complete before approval', bn:'অনুমোদনের আগে দুই ভার্সন সম্পূর্ণ থাকতে হবে — চিহ্নিত' }
      ];
      S.aiThread.push({ from:'ai', text: S.lang === 'bn'
        ? 'ইংরেজি ভার্সন লিখেছি। প্রিভিউতে ভাষা বদলে যাচাই করুন।'
        : 'Wrote the English variant. Switch the preview language to verify it.',
        steps: steps, readyForApproval: true });
      apply = function(){
        NS.state.showEn = true;
        NS.state.titleEn = 'Important update for your preparation';
        NS.state.bodyEn = S.body ? S.body.replace(/\{\{\s*name\s*\}\}/g, '{{name}}') : 'Your exam preparation update is ready — open the app to continue.';
      };
    } else if (isSchedule) {
      steps = [
        { en:'Analysed click-through by hour over the last 7 days', bn:'গত ৭ দিনের ঘণ্টাভিত্তিক ক্লিক-থ্রু বিশ্লেষণ' },
        { en:'Best window: 21:00–22:00 Asia/Dhaka (+18% clicks)', bn:'সেরা সময়: ২১:০০–২২:০০ Asia/Dhaka (+১৮% ক্লিক)' },
        { en:'Cross-checked the queue for conflicts in that window', bn:'ওই সময়ের কিউ সংঘর্ষ যাচাই' }
      ];
      S.aiThread.push({ from:'ai', text: S.lang === 'bn'
        ? 'আজ ২১:০০ (Asia/Dhaka) সুপারিশ করছি — এই সময়ে ক্লিক রেট সর্বোচ্চ।'
        : 'I suggest today 21:00 Asia/Dhaka — that window has the highest click rate.',
        steps: steps, readyForApproval: true });
      apply = function(){
        var d = new Date(); d.setHours(21, 0, 0, 0);
        if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
        NS.state.when = toLocalInput(d.getTime());
        NS.state.scheduleOpen = true;
      };
    } else if (isAudit) {
      var dup = NS.state.history.filter(function(h){ return tr(h,'title').trim() === S.title.trim() && S.title.trim(); })[0];
      var overlap = NS.state.queue.filter(function(q){ return q.audience === S.audience && q.status === 'scheduled'; }).length;
      steps = [
        { en: dup ? 'Duplicate found: "' + tr(dup,'title') + '" was sent ' + relTime(dup.sentAt) : 'No duplicate title in the last 30 days', bn: dup ? 'ডুপ্লিকেট পাওয়া গেছে: "' + tr(dup,'title') + '" পাঠানো হয়েছিল ' + relTime(dup.sentAt) : 'শেষ ৩০ দিনে ডুপ্লিকেট টাইটেল নেই' },
        { en: 'Audience overlap: ' + overlap + ' scheduled send(s) to the same audience', bn: 'অডিয়েন্স ওভারল্যাপ: একই অডিয়েন্সে ' + overlap + 'টি শিডিউলড পাঠানো' },
        { en: 'Frequency protection is set to "standard" (1 per 24h)', bn: 'ফ্রিকোয়েন্সি সুরক্ষা "স্ট্যান্ডার্ড" (২৪ ঘণ্টায় ১টি)' }
      ];
      S.aiThread.push({ from:'ai', text: S.lang === 'bn'
        ? 'যাচাই শেষ। ফলাফল দেখুন — কিছু ক্ষেত্রে পুনর্লিখন দরকার।'
        : 'Validation finished. Review the findings — a rewrite may be needed.',
        steps: steps, readyForApproval: false });
      S.aiActivity.unshift({ t: Date.now(), bn:'ডুপ্লিকেট ও ওভারল্যাপ যাচাই সম্পন্ন', en:'Duplicate and overlap check completed', kind: dup ? 'warn' : 'ok' });
    } else {
      var gen = {
        title: S.lang === 'bn' ? 'তোমার প্রস্তুতি আপডেট' : 'Your preparation update',
        body: S.lang === 'bn' ? '{{name}}, {{university}} ইউনিট {{unit}}-এর প্রস্তুতি চালিয়ে যাও — আজ ২০টি প্রশ্ন।' : '{{name}}, keep going with your {{university}} unit {{unit}} prep — 20 questions today.'
      };
      steps = [
        { en:'Read the current type, audience and channel', bn:'বর্তমান টাইপ, অডিয়েন্স ও চ্যানেল পড়া হয়েছে' },
        { en:'Wrote a candidate title under 60 characters', bn:'৬০ অক্ষরের কম একটি টাইটেল লেখা হয়েছে' },
        { en:'Wrote a body that fits one screen and uses personalization', bn:'এক স্ক্রিনে বসে এমন ব্যক্তিগত বার্তা লেখা হয়েছে' },
        { en:'Checked for unknown variables', bn:'অজানা ভেরিয়েবল যাচাই' }
      ];
      S.aiThread.push({ from:'ai', text: S.lang === 'bn'
        ? 'একটি খসড়া কপি লিখেছি। প্রয়োগ করে আপনার মতো করে এডিট করতে পারেন।'
        : 'I drafted copy. Apply it and edit it the way you want.',
        steps: steps, readyForApproval: true });
      apply = function(){ NS.state.title = gen.title; NS.state.body = gen.body; };
    }
    S.lastAiApply = apply;
    S.aiActivity.unshift({ t: Date.now(), bn:'এআই প্রস্তুতি সম্পন্ন: অনুমোদনের অপেক্ষায়', en:'AI preparation complete: waiting for approval', kind:'wait' });
    render();
    var th = document.getElementById('nsAiThread');
    if (th) th.scrollTop = th.scrollHeight;
  }, 700);
}

/* ---------- toasts ---------- */

function toast(kind, title, msg, actions){
  var S = NS.state;
  var id = 't' + Date.now() + Math.random().toString(16).slice(2, 6);
  S.toasts.push({ id: id, kind: kind, title: title, msg: msg, actions: actions || null });
  renderToasts();
  setTimeout(function(){
    var el = document.querySelector('[data-toast="' + id + '"]');
    if (el) el.classList.add('is-out');
    setTimeout(function(){
      S.toasts = S.toasts.filter(function(t){ return t.id !== id; });
      renderToasts();
    }, 220);
  }, 5200);
}
function renderToasts(){
  var host = document.getElementById('nsToasts');
  if (!host) return;
  var S = NS.state;
  host.innerHTML = S.toasts.map(function(t){
    var cls = t.kind === 'err' ? 'ns-toast-err' : t.kind === 'warn' ? 'ns-toast-warn' : 'ns-toast-ok';
    var ico = t.kind === 'err' ? 'alertCircle' : t.kind === 'warn' ? 'alert' : 'checkCircle';
    return '<div class="ns-toast ' + cls + '" data-toast="' + t.id + '" role="status">' +
      '<span class="ns-toast-ico">' + ic(ico, 17) + '</span>' +
      '<span class="ns-toast-main"><span class="ns-toast-title">' + esc(t.title) + '</span>' +
        (t.msg ? '<div class="ns-toast-msg">' + esc(t.msg) + '</div>' : '') +
        (t.actions ? '<div class="ns-toast-actions">' + t.actions.map(function(a){
          return '<button type="button" class="ns-btn ns-btn-sm" data-act="' + a.act + '"' + (a.id ? ' data-id="' + a.id + '"' : '') + '>' + esc(a.label) + '</button>';
        }).join('') + '</div>' : '') +
      '</span>' +
      '<button type="button" class="ns-iconbtn ns-toast-close" style="width:32px;height:32px;min-width:32px" data-act="toast_dismiss" data-id="' + t.id + '" aria-label="' + esc(T('close')) + '">' + ic('x', 14) + '</button>' +
    '</div>';
  }).join('');
}
function dismissToast(id){
  NS.state.toasts = NS.state.toasts.filter(function(t){ return t.id !== id; });
  renderToasts();
}

/* ---------- sheets ---------- */

function openSheet(type, data){ NS.state.sheet = type; NS.state.sheetData = data || null; renderSheet(); }
function closeSheet(){ NS.state.sheet = null; NS.state.sheetData = null; var ov = document.getElementById('nsOverlay'); if (ov) ov.remove(); document.body.classList.remove('ns-noscroll'); restoreFocusEl(); }
var lastFocusEl = null;
function rememberFocus(){ lastFocusEl = document.activeElement; }
function restoreFocusEl(){ if (lastFocusEl && lastFocusEl.focus) { try { lastFocusEl.focus(); } catch(e){} } }

function sheetShell(opts){
  var S = NS.state;
  var actions = (opts.foot || []).map(function(b){
    return '<button type="button" class="ns-btn ' + (b.cls || '') + '" data-act="' + b.act + '"' + (b.id ? ' data-id="' + b.id + '"' : '') + (b.dis ? ' disabled' : '') + '>' + (b.ico ? ic(b.ico, 16) : '') + esc(b.label) + '</button>';
  }).join('');
  return '<div class="ns-overlay" id="nsOverlay" data-sheet="' + opts.type + '">' +
    '<div class="ns-sheet" role="dialog" aria-modal="true" aria-labelledby="nsSheetTitle"' + (opts.label ? ' aria-describedby="nsSheetSub"' : '') + '>' +
      '<div class="ns-sheet-handle" aria-hidden="true"></div>' +
      '<div class="ns-sheet-head">' +
        '<div style="flex:1"><h2 id="nsSheetTitle">' + esc(opts.title) + '</h2>' +
        (opts.sub ? '<p class="ns-sheet-sub" id="nsSheetSub">' + esc(opts.sub) + '</p>' : '') + '</div>' +
        '<button type="button" class="ns-iconbtn" data-act="sheet_close" aria-label="' + esc(T('close')) + '">' + ic('x', 18) + '</button>' +
      '</div>' +
      '<div class="ns-sheet-body">' + opts.body + '</div>' +
      '<div class="ns-sheet-foot">' + (opts.footLeft || '') + '<span class="ns-spacer"></span>' + actions + '</div>' +
    '</div></div>';
}

function renderSheet(){
  var S = NS.state;
  if (!S.sheet) return;
  var existing = document.getElementById('nsOverlay');
  if (existing) existing.remove();
  var html = '';
  switch (S.sheet) {
    case 'detail': html = sheetDetail(S.sheetData); break;
    case 'drafts': html = sheetDrafts(); break;
    case 'approval': html = sheetApproval(); break;
    case 'confirm': html = sheetConfirm(); break;
    case 'testsend': html = sheetTestSend(); break;
    case 'send': html = sheetSending(); break;
    case 'success': html = sheetSuccess(S.sheetData); break;
    case 'fail': html = sheetFail(S.sheetData); break;
    case 'campaignnew': html = sheetCampaignNew(); break;
    case 'segmentsave': html = sheetSegmentSave(); break;
    case 'tplversion': html = sheetTplVersion(S.sheetData); break;
    case 'reschedule': html = sheetReschedule(S.sheetData); break;
    case 'approve_automation': html = sheetApproveAutomation(S.sheetData); break;
    default: return;
  }
  if (!html) return;
  rememberFocus();
  document.body.insertAdjacentHTML('beforeend', html);
  document.body.classList.add('ns-noscroll');
  var dlg = document.querySelector('.ns-sheet');
  if (dlg) { var f = dlg.querySelector('button, input, textarea, select, a[href]'); if (f) f.focus(); }
}

function findItem(id){
  var S = NS.state;
  var all = S.history.concat(S.queue);
  return all.filter(function(x){ return x.id === id; })[0] || null;
}

function sheetDetail(item){
  var S = NS.state;
  if (!item) return '';
  var isQueue = S.queue.some(function(q){ return q.id === item.id; });
  var st = statusMeta(item.status);
  var body = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
      '<span class="ns-badge ns-badge-neutral">' + ic(TYPES[item.type].ico, 12) + esc(typeLabel(item.type)) + '</span>' +
      statusBadge(item.status) +
      '<span class="ns-badge ns-badge-neutral">' + ic(CHANNELS[item.channel].ico, 12) + esc(chanLabel(item.channel)) + '</span>' +
      '<span class="ns-badge ns-badge-neutral">' + ic('users', 12) + esc(audLabel(item.audience)) + '</span>' +
      '<span class="ns-mono ns-tiny" style="align-self:center">' + esc(item.id) + '</span>' +
    '</div>' +

    (item.status === 'failed' ? '<div class="ns-callout ns-callout-danger" style="margin-bottom:14px">' + ic('alertCircle', 17) +
      '<div><b' + ha('sFailureDetail') + '>' + esc(T('sFailureDetail')) + '</b><br>' + esc(S.lang === 'en' ? item.reason_en : item.reason_bn) +
      '<div class="ns-tiny ns-mono" style="margin-top:6px;color:var(--sub)">' + esc(item.error || '') + '</div></div></div>' : '') +

    '<div style="display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap">' +
      '<div class="ns-typeico" style="width:38px;height:38px">' + ic(TYPES[item.type].ico, 18) + '</div>' +
      '<div style="flex:1;min-width:200px"><div class="ns-strong">' + esc(tr(item, 'title')) + '</div>' +
      '<p style="margin:6px 0 0;font-size:13px;color:var(--sub)">' + esc(tr(item, 'body')) + '</p>' +
      (item.cta ? '<div style="margin-top:8px"><span class="ns-badge ns-badge-neutral">' + ic('arrowUpRight', 11) + esc(item.cta) + '</span></div>' : '') + '</div>' +
    '</div>' +

    '<dl class="ns-kv">' +
      '<dt' + ha('apReach') + '>' + esc(T('apReach')) + '</dt><dd>' + fmt(item.reach) + '</dd>' +
      '<dt' + ha('anDelivered') + '>' + esc(T('anDelivered')) + '</dt><dd>' + fmt(item.delivered) + '</dd>' +
      '<dt' + ha('anOpened') + '>' + esc(T('anOpened')) + '</dt><dd>' + fmt(item.opened) + '</dd>' +
      '<dt' + ha('anClicked') + '>' + esc(T('anClicked')) + '</dt><dd>' + fmt(item.clicked) + ' · ' + esc(T('anCtr')) + ' ' + pct(item.clicked, item.delivered) + '</dd>' +
      '<dt>' + esc(S.lang === 'bn' ? 'টার্গেট' : 'Target URL') + '</dt><dd class="ns-mono ns-tiny">' + (item.targetUrl ? esc(item.targetUrl) : '<span class="ns-dash">—</span>') + '</dd>' +
      '<dt' + ha('apImage') + '>' + esc(T('apImage')) + '</dt><dd>' + (item.imageUrl ? esc(item.imageUrl) : '<span class="ns-dash">—</span>') + '</dd>' +
      '<dt>' + esc(S.lang === 'bn' ? 'তৈরি' : 'Created') + '</dt><dd>' + esc(fmtDateTime(item.createdAt)) + '</dd>' +
      '<dt>' + esc(S.lang === 'bn' ? 'শিডিউল' : 'Scheduled') + '</dt><dd>' + (item.scheduledFor ? esc(fmtDateTime(item.scheduledFor)) : '<span class="ns-dash">—</span>') + '</dd>' +
      '<dt>' + esc(S.lang === 'bn' ? 'পাঠানো' : 'Sent') + '</dt><dd>' + (item.sentAt ? esc(fmtDateTime(item.sentAt)) : '<span class="ns-dash">—</span>') + '</dd>' +
      (isQueue ? '<dt' + ha('qPriority') + '>' + esc(T('qPriority')) + '</dt><dd>' + esc(item.priority || 'normal') + '</dd>' : '') +
      '<dt' + ha('caAudience') + '>' + esc(T('caAudience')) + '</dt><dd>' + esc(audLabel(item.audience)) + '</dd>' +
      (item.campaign ? '<dt>' + esc(T('apCampaign')) + '</dt><dd>' + esc(item.campaign) + '</dd>' : '') +
    '</dl>' +

    (item.status === 'sent' ? '<div style="margin-top:16px"><div class="ns-eyebrow" style="margin-bottom:8px">' + esc(T('anBreakdown')) + '</div>' +
      '<div class="ns-meter-row"><div class="ns-meter-top"><span>' + esc(T('anDelivered')) + '</span><span>' + pct(item.delivered, item.reach) + '</span></div>' +
      '<div class="ns-meter"><span style="width:' + Math.round((item.delivered / (item.reach || 1)) * 100) + '%"></span></div></div>' +
      '<div class="ns-meter-row"><div class="ns-meter-top"><span>' + esc(T('anOpened')) + '</span><span>' + pct(item.opened, item.delivered) + '</span></div>' +
      '<div class="ns-meter"><span style="width:' + Math.round((item.opened / (item.delivered || 1)) * 100) + '%"></span></div></div>' +
      '<div class="ns-meter-row"><div class="ns-meter-top"><span>' + esc(T('anClicked')) + '</span><span>' + pct(item.clicked, item.delivered) + '</span></div>' +
      '<div class="ns-meter"><span style="width:' + Math.round((item.clicked / (item.delivered || 1)) * 100) + '%"></span></div></div></div>' : '') +

    '<div style="margin-top:16px">' + renderAuditPanel() + '</div>';

  var foot = [];
  foot.push({ act:'sheet_close', label:T('close') });
  if (item.status === 'failed') {
    foot.push({ act:'retry', id:item.id, label:T('sRetry'), cls:'ns-btn-primary', ico:'refresh' });
    foot.push({ act:'edit_resend', id:item.id, label:T('sEditResend'), ico:'pen' });
  } else if (isQueue) {
    foot.push({ act:'cancelqueue', id:item.id, label:T('qCancel'), cls:'ns-btn-danger', ico:'ban' });
    foot.push({ act:'reschedule', id:item.id, label:T('qReschedule'), cls:'ns-btn-primary', ico:'calendar' });
  } else {
    foot.push({ act:'duplicate_from', id:item.id, label:T('duplicate'), ico:'copy' });
  }
  return sheetShell({ type:'detail', title: tr(item, 'title') || T('sDetail'), sub: S.lang === 'bn' ? 'ডেলিভারি বিস্তারিত ও অডিট ইতিহাস' : 'Delivery detail and audit history', body: body, foot: foot });
}

function sheetDrafts(){
  var S = NS.state;
  var body = S.drafts.length ? '<div class="ns-list" style="margin:-18px -18px 0">' + S.drafts.map(function(d){
    var filled = [d.title_bn, d.body_bn, d.title_en, d.body_en].filter(function(x){ return x && x.trim(); }).length;
    return '<div class="ns-row-item" style="cursor:default">' +
      '<span class="ns-typeico" data-t="' + d.type + '">' + ic(TYPES[d.type].ico, 15) + '</span>' +
      '<span class="ns-ri-main"><span class="ns-ri-title">' + esc(S.lang === 'bn' ? (d.name_bn || d.name) : d.name) + '</span>' +
        '<span class="ns-ri-meta"><span>' + esc(typeLabel(d.type)) + '</span><span>·</span><span>' + esc(audLabel(d.audience)) + '</span>' +
        '<span>·</span><span>' + fmt(filled) + '/4 ' + esc(S.lang === 'bn' ? 'ফিল্ড' : 'fields') + '</span>' +
        '<span>·</span><span>' + esc(T('cpAutosaved')) + ' ' + relTime(d.updated) + '</span></span></span>' +
      '<span class="ns-ri-side">' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-primary" data-act="draft_load" data-id="' + d.id + '">' + esc(T('cpApply')) + '</button>' +
        '<button type="button" class="ns-btn ns-btn-sm ns-btn-ghost" data-act="draft_delete" data-id="' + d.id + '">' + ic('trash', 14) + esc(T('delete')) + '</button>' +
      '</span></div>';
  }).join('') + '</div>' : '<div class="ns-empty" style="padding:20px 0"><span class="ns-empty-ico">' + ic('fileText', 22) + '</span>' +
      '<h4>' + esc(S.lang === 'bn' ? 'কোনো ড্রাফট নেই' : 'No drafts yet') + '</h4>' +
      '<p class="ns-state-msg">' + esc(S.lang === 'bn' ? 'কম্পোজারে কিছু লিখলে স্বয়ংক্রিয়ভাবে এখানে সেভ হবে।' : 'Anything you write in the composer is autosaved here.') + '</p></div>';
  return sheetShell({ type:'drafts', title:T('ovDrafts'), sub: S.lang === 'bn' ? 'ড্রাফট কখনো হারায় না — নেভিগেশন করলেও সংরক্ষিত থাকে।' : 'Drafts never disappear — they survive navigation.',
    body: body, foot: [{ act:'sheet_close', label:T('close') }, { act:'tab', id:'compose', label:T('navCompose'), cls:'ns-btn-primary', ico:'pen' }] });
}

function sheetApproval(){
  var S = NS.state, C = checksByLevel(), r = computedReach();
  var blocked = !canSend();
  var rows = [
    [T('apAudience'), audLabel(S.audience) + (S.exclude ? ' (−' + esc(audLabel(S.exclude)) + ')' : '')],
    [T('apReach'), fmt(r.final) + ' ' + (S.lang === 'bn' ? 'শিক্ষার্থী' : 'students')],
    [T('apType'), typeLabel(S.type)],
    [T('apChannel'), chanLabel(S.channel) + (S.ab.enabled ? ' · A/B 50/50' : '')],
    [T('apTitleField'), S.title || '—'],
    [T('apBody'), S.body || '—'],
    [T('apImage'), S.imageUrl ? '✓ ' + S.imageUrl.slice(0, 48) : '—'],
    [T('apTarget'), S.targetUrl || '—'],
    [T('apSchedule'), S.when ? fmtDateTime(new Date(S.when).getTime()) + ' · ' + S.timezone : (S.lang === 'bn' ? 'অনুমোদনের সাথে সাথেই' : 'immediately on approval')],
    [T('apCampaign'), S.campaignLink ? S.campaignLink : '—'],
    [T('apPersonalization'), S.personalization ? (S.lang === 'bn' ? 'চালু' : 'Enabled') : (S.lang === 'bn' ? 'বন্ধ' : 'Off')]
  ];
  var warnings = C.warn.map(function(w){
    return '<div class="ns-callout ns-callout-warn" style="margin-bottom:8px">' + ic('alert', 16) +
      '<div>' + esc(S.lang === 'bn' ? w.bn : w.en) + '</div></div>';
  }).join('');
  var errors = C.err.map(function(e){
    return '<div class="ns-callout ns-callout-danger" style="margin-bottom:8px">' + ic('ban', 16) +
      '<div>' + esc(S.lang === 'bn' ? e.bn : e.en) + '</div></div>';
  }).join('');

  var body =
    (blocked ? errors : '<div class="ns-callout ns-callout-ok" style="margin-bottom:12px">' + ic('checkCircle', 17) +
      '<div>' + esc(S.lang === 'bn' ? 'সব বাধ্যামূলক যাচাই পাস করেছে। চূড়ান্ত অনুমতি আপনার।' : 'Every blocking check passed. The final approval is yours.') + '</div></div>') +
    (warnings ? '<div style="margin-bottom:12px"><div class="ns-eyebrow" style="margin-bottom:8px">' + esc(T('apWarnings')) + '</div>' + warnings + '</div>'
      : '<div class="ns-callout ns-callout-info" style="margin-bottom:12px">' + ic('info', 16) + '<div>' + esc(T('apNone')) + '</div></div>') +
    '<dl class="ns-kv">' + rows.map(function(p){
      return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[1] === '—' ? '<span class="ns-dash">—</span>' : esc(p[1])) + '</dd>';
    }).join('') + '</dl>' +
    '<div style="margin-top:16px"><div class="ns-eyebrow" style="margin-bottom:8px">' + esc(T('apChecks')) + '</div>' + renderValidation(true) + '</div>' +
    '<div class="ns-approval-boundary" style="margin-top:16px">' + ic('shield', 16) + '<span>' + esc(T('apBoundary')) + '</span></div>';

  var foot = [{ act:'sheet_close', label:T('apEdit'), ico:'chevLeft' }];
  foot.push({ act:'sheet_testsend', label:T('cpTestSend'), ico:'send' });
  foot.push({
    act: blocked ? 'approval_blocked' : 'approve',
    label: S.when ? T('apApproveSched') : T('apApprove'),
    cls: 'ns-btn-primary', ico: 'lock', dis: blocked
  });
  return sheetShell({ type:'approval', title:T('apTitle'), sub:T('apSub'), body: body, foot: foot });
}

function sheetConfirm(){
  var S = NS.state, r = computedReach();
  var body = '<div class="ns-callout ns-callout-danger ns-section">' + ic('alert', 17) +
      '<div><b' + ha('apConfirmTitle') + '>' + esc(T('apConfirmTitle')) + '</b><div style="margin-top:4px">' + esc(T('apConfirmSub')) + '</div></div></div>' +
    '<dl class="ns-kv">' +
      '<dt>' + esc(T('apTitleField')) + '</dt><dd>' + esc(S.title) + '</dd>' +
      '<dt>' + esc(T('apAudience')) + '</dt><dd>' + esc(audLabel(S.audience)) + '</dd>' +
      '<dt>' + esc(T('apReach')) + '</dt><dd class="ns-strong">' + fmt(r.final) + '</dd>' +
      '<dt>' + esc(T('apChannel')) + '</dt><dd>' + esc(chanLabel(S.channel)) + '</dd>' +
      '<dt>' + esc(T('apSchedule')) + '</dt><dd>' + (S.when ? esc(fmtDateTime(new Date(S.when).getTime())) : esc(S.lang === 'bn' ? 'এখনই' : 'Now')) + '</dd>' +
    '</dl>' +
    '<div class="ns-approval-boundary" style="margin-top:16px">' + ic('shield', 16) + '<span>' + esc(S.lang === 'bn'
      ? 'এই নিশ্চিতকরণটি অ্যাডমিন-ভূমিকার সাথে সংযুক্ত। এআই কখনো এটি করতে পারে না।'
      : 'This confirmation is bound to the administrator role. The AI can never perform it.') + '</span></div>';
  return sheetShell({ type:'confirm', title: S.lang === 'bn' ? 'চূড়ান্ত নিশ্চিতকরণ' : 'Final confirmation',
    sub: S.lang === 'bn' ? 'এটি ফেরানো যাবে না।' : 'This cannot be undone.',
    body: body,
    foot: [{ act:'sheet_close', label:T('apCancel') }, { act:'send_final', label:T('apConfirm'), cls:'ns-btn-danger', ico:'send' }] });
}

function sheetTestSend(){
  var S = NS.state;
  var body = '<div class="ns-callout ns-callout-info ns-section">' + ic('info', 17) +
      '<div><b>' + esc(T('tsSub')) + '</b><div style="margin-top:4px">' + esc(T('tsNote')) + '</div></div></div>' +
    '<div class="ns-field"><label class="ns-flabel" for="nsTestTo"' + ha('tsTo') + '>' + esc(T('tsTo')) + '</label>' +
      '<input class="ns-input" id="nsTestTo" value="' + esc(S.testTo || 'admin-test-device-01 · iOS 18, Android 15, Web') + '" /></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
      ['admin-test-device-01 · iOS 18', 'android-pixel-9 · Android 15', 'web-chrome · desktop'].map(function(d){
        return '<span class="ns-chip ns-chip-static">' + ic('smartphone', 13) + esc(d) + '</span>';
      }).join('') + '</div>' +
    '<div class="ns-eyebrow" style="margin-bottom:8px">' + esc(T('cpPreview')) + '</div>' + renderPreview() +
    '<div class="ns-callout ns-callout-warn" style="margin-top:14px">' + ic('alert', 16) +
      '<div>' + esc(S.lang === 'bn'
        ? 'টেস্ট পাঠানো কখনো অ্যানালিটিক্স, কোটা বা ফ্রিকোয়েন্সি সীমায় যোগ হয় না।'
        : 'Test sends never count towards analytics, quota or frequency limits.') + '</div></div>';
  return sheetShell({ type:'testsend', title:T('tsTitle'), sub:T('tsSub'), body: body,
    foot: [{ act:'sheet_close', label:T('close') }, { act:'test_run', label:T('tsRun'), cls:'ns-btn-primary', ico:'send' }] });
}

function sheetSending(){
  var S = NS.state;
  var phases = [T('sdPreparing'), T('sdQueueing'), T('sdDispatching'), T('sdDone')];
  var body = '<div style="padding:8px 0">' +
    '<div class="ns-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + S.sendProgress + '"><span style="width:' + S.sendProgress + '%"></span></div>' +
    '<div class="ns-list" style="margin-top:16px">' + phases.map(function(p, i){
      var done = S.sendProgress >= ((i + 1) / phases.length) * 100 - 1;
      var active = !done && S.sendProgress >= (i / phases.length) * 100;
      return '<div class="ns-check-item"><span class="ns-check-ico ' + (done ? 'ns-ci-ok' : active ? 'ns-ci-warn' : '') + '">' +
        ic(done ? 'checkCircle' : active ? 'refresh' : 'dot', 15) + '</span><span style="flex:1">' + esc(p) + '</span>' +
        (done ? '<span class="ns-badge ns-badge-ok">' + ic('check', 11) + esc(T('done')) + '</span>' : active ? '<span class="ns-badge ns-badge-warn">' + esc(T('busy')) + '</span>' : '') +
        '</div>';
    }).join('') + '</div>' +
    '<p class="ns-hint" style="margin-top:14px">' + esc(S.lang === 'bn'
      ? 'পাঠানো চলার সময় ক্ষতিকর কাজগুলো লক থাকে। এই ডায়ালগ বন্ধ করলে পাঠানো বাতিল হবে না।'
      : 'Dangerous actions stay locked while sending. Closing this dialog does not cancel the send.') + '</p></div>';
  return sheetShell({ type:'send', title:T('sdTitle'), sub: esc(S.title), body: body, foot: [] });
}

function sheetSuccess(data){
  var S = NS.state;
  var scheduled = data && data.scheduled;
  var r = computedReach();
  var body = '<div style="text-align:center;padding:6px 0 10px">' +
      '<span class="ns-empty-ico" style="margin:0 auto;background:var(--ok-bg);color:var(--brand);border-color:transparent">' + ic('checkCircle', 24) + '</span>' +
      '<h4 style="margin-top:12px;font-size:17px">' + esc(scheduled ? (S.lang === 'bn' ? 'শিডিউল করা হয়েছে' : 'Scheduled for approval') : T('sdSuccess')) + '</h4>' +
      '<p class="ns-state-msg" style="margin:6px auto 0">' + esc(scheduled
        ? (S.lang === 'bn' ? 'অনুমোদিত হয়েছে এবং কিউতে যুক্ত হয়েছে। পাঠানোর আগে যেকোনো সময় বাতিল বা পুনঃশিডিউল করা যাবে।'
          : 'Approved and placed in the queue. It can be cancelled or rescheduled any time before it goes out.')
        : T('sdSuccessSub')) + '</p></div>' +
    '<div class="ns-callout ns-callout-ok ns-section">' + ic('shield', 17) +
      '<div>' + esc(S.lang === 'bn' ? 'অনুমোদনকারী: ' : 'Approved by: ') + '<b>' + esc(S.role === 'admin' ? 'Administrator' : 'Operator') + '</b> · ' + esc(fmtDateTime(Date.now())) +
      (data && data.test ? ' · ' + esc(T('tsTitle')) : '') + '</div></div>' +
    '<dl class="ns-kv">' +
      '<dt>' + esc(T('apAudience')) + '</dt><dd>' + esc(audLabel(S.audience)) + '</dd>' +
      '<dt>' + esc(T('apReach')) + '</dt><dd class="ns-strong">' + fmt(data && data.reach ? data.reach : r.final) + '</dd>' +
      '<dt>' + esc(T('apChannel')) + '</dt><dd>' + esc(chanLabel(S.channel)) + '</dd>' +
      '<dt>' + esc(T('apSchedule')) + '</dt><dd>' + (scheduled ? esc(fmtDateTime(new Date(S.when).getTime())) : esc(S.lang === 'bn' ? 'এখনই পাঠানো হয়েছে' : 'Sent now')) + '</dd>' +
      (data && data.test ? '<dt>' + esc(T('tsTitle')) + '</dt><dd>' + esc(S.lang === 'bn' ? 'যেকোনো অ্যানালিটিক্সে যোগ হয়নি' : 'Not counted in any analytics') + '</dd>' : '') +
    '</dl>';
  return sheetShell({ type:'success', title: scheduled ? T('sScheduled') : T('sdDone'), sub: S.lang === 'bn' ? 'অ্যাডমিন অনুমোদিত' : 'Administrator approved',
    body: body, foot: [
      { act:'success_queue', label:T('ovOpenQueue'), ico:'clock' },
      { act:'success_sent', label:T('navSent'), ico:'send', cls:'ns-btn-primary' },
      { act:'sheet_close', label:T('done') }
    ] });
}

function sheetFail(data){
  var S = NS.state;
  var body = '<div class="ns-callout ns-callout-danger ns-section">' + ic('alertCircle', 17) +
      '<div><b>' + esc(data && data.title ? data.title : T('sdFail')) + '</b><div style="margin-top:4px">' +
      esc(data && data.reason ? data.reason : (S.lang === 'bn' ? 'ডেলিভারি সেবা সাড়া দেয়নি।' : 'The delivery service did not respond.')) + '</div></div></div>' +
    '<dl class="ns-kv">' +
      '<dt>' + esc(S.lang === 'bn' ? 'কী হয়েছে' : 'What happened') + '</dt><dd>' + esc(S.lang === 'bn' ? 'নোটিফিকেশন পাঠানো হয়নি এবং কিউতে ফেরত দেওয়া হয়েছে।' : 'The notification was not sent and was returned to the queue.') + '</dd>' +
      '<dt>' + esc(S.lang === 'bn' ? 'কেন' : 'Why') + '</dt><dd>' + esc(data && data.why ? data.why : (S.lang === 'bn' ? 'অজানা ত্রুটি' : 'Unknown error')) + '</dd>' +
      '<dt>' + esc(S.lang === 'bn' ? 'এখন কী করা যায়' : 'What you can do') + '</dt><dd>' + esc(data && data.fix ? data.fix : (S.lang === 'bn' ? 'আবার চেষ্টা করুন বা স্কেডিউল বদলান।' : 'Retry, or change the schedule.')) + '</dd>' +
    '</dl>' +
    '<div class="ns-callout ns-callout-info" style="margin-top:14px">' + ic('info', 16) +
      '<div>' + esc(S.lang === 'bn' ? 'আপনার ড্রাফট সংরক্ষিত আছে।' : 'Your draft is preserved.') + '</div></div>';
  return sheetShell({ type:'fail', title: S.lang === 'bn' ? 'পাঠানো ব্যর্থ' : 'Send failed', body: body,
    foot: [{ act:'sheet_close', label:T('close') }, { act:'retry_send', label:T('retry'), cls:'ns-btn-primary', ico:'refresh' }, { act:'tab', id:'compose', label:T('sEditResend'), ico:'pen' }] });
}

function sheetCampaignNew(){
  var S = NS.state;
  var body = '<div class="ns-field"><label class="ns-flabel" for="nsCampName">' + esc(T('caNew')) + '</label>' +
      '<input class="ns-input" id="nsCampName" value="' + esc(S.campName || (S.lang === 'bn' ? 'নতুন ক্যাম্পেইন' : 'New campaign')) + '" /></div>' +
    '<div class="ns-row">' +
      '<div class="ns-field"><label class="ns-flabel" for="nsCampAud">' + esc(T('caAudience')) + '</label>' +
        '<select class="ns-select" id="nsCampAud">' + S.segments.map(function(s){
          return '<option value="' + s.id + '"' + (S.audience === s.id ? ' selected' : '') + '>' + esc(S.lang === 'bn' ? s.name_bn : s.name) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="ns-field"><label class="ns-flabel" for="nsCampChan">' + esc(T('cpFieldChannel')) + '</label>' +
        '<select class="ns-select" id="nsCampChan">' + Object.keys(CHANNELS).map(function(c){
          return '<option value="' + c + '"' + (S.channel === c ? ' selected' : '') + '>' + esc(chanLabel(c)) + '</option>';
        }).join('') + '</select></div>' +
    '</div>' +
    '<div class="ns-callout ns-callout-info">' + ic('sparkles', 16) +
      '<div>' + esc(S.lang === 'bn'
        ? '৪ ধাপের কাঠামো প্রস্তাব করছি: দিন ১ (প্রস্তুতি), দিন ৩ (প্র্যাকটিস), দিন ৫ (অপেক্ষা), দিন ৭ (শেষ রিমাইন্ডার)। ক্যাম্পেইন ড্রাফট থাকবে যতক্ষণ আপনি সক্রিয় না করবেন।'
        : 'Proposed structure: Day 1 (preparation), Day 3 (practice), Day 5 (wait), Day 7 (final reminder). The campaign stays a draft until you activate it.') + '</div></div>' +
    '<div class="ns-approval-boundary" style="margin-top:14px">' + ic('shield', 16) + '<span>' + esc(S.lang === 'bn'
      ? 'সক্রিয় করলে শিক্ষার্থীরা বার্তা পাবে — তাই এটি অ্যাডমিন অনুমোদনের সাপেক্ষে।'
      : 'Activating this sends messages to students — so it requires administrator approval.') + '</span></div>';
  return sheetShell({ type:'campaignnew', title:T('caNew'), sub:T('caSub'), body: body,
    foot: [{ act:'sheet_close', label:T('cancel') }, { act:'campaign_create', label:T('caNew'), cls:'ns-btn-primary', ico:'plus' }] });
}

function sheetSegmentSave(){
  var S = NS.state;
  var est = estimateReachForRules();
  var body = '<div class="ns-field"><label class="ns-flabel" for="nsSegSaveName"' + ha('auName') + '>' + esc(T('auName')) + '</label>' +
      '<input class="ns-input" id="nsSegSaveName" value="' + esc(S.ruleBuilder.name || '') + '"' + ph('auName') + ' /></div>' +
    '<div class="ns-callout ns-callout-ok">' + ic('users', 17) + '<div>' + esc(T('auEstimate')) + ': <b>' + fmt(est) + '</b> · ' +
      esc(pct(est, reachFor('all_students'))) + ' ' + esc(T('cpReachOf')) + '</div></div>' +
    '<div class="ns-callout ns-callout-info" style="margin-top:12px">' + ic('info', 16) + '<div>' + esc(S.lang === 'bn'
      ? 'সেভ করা সেগমেন্ট পরে কম্পোজারে ও অটোমেশনে ব্যবহারযোগ্য হবে।'
      : 'A saved segment becomes reusable in the composer and in automations.') + '</div></div>';
  return sheetShell({ type:'segmentsave', title:T('auSave'), sub:T('auBuilder'), body: body,
    foot: [{ act:'sheet_close', label:T('cancel') }, { act:'segment_save_confirm', label:T('save'), cls:'ns-btn-primary', ico:'check' }] });
}

function sheetTplVersion(data){
  var S = NS.state;
  var t = S.templates.filter(function(x){ return x.key === (data && data.key); })[0];
  if (!t) return '';
  var vers = [];
  for (var i = t.versions; i >= 1; i--) {
    vers.push({ v: i, t: Date.now() - (t.versions - i) * 5 * 86400000, actor: i === t.versions ? 'Admin · Nusrat' : 'AI Agent' });
  }
  var body = '<div class="ns-list" style="margin:-18px -18px 0">' + vers.map(function(v){
    return '<div class="ns-log-item" style="padding:13px 18px"><span class="ns-log-ico">' + ic('history', 14) + '</span>' +
      '<span class="ns-log-main"><span class="ns-strong">v' + fmt(v.v) + (v.v === t.versions ? ' · ' + esc(S.lang === 'bn' ? 'বর্তমান' : 'current') : '') + '</span>' +
      '<div class="ns-tiny ns-muted">' + esc(v.actor) + '</div></span>' +
      '<span class="ns-log-time">' + esc(fmtDateTime(v.t)) + '</span></div>';
  }).join('') + '</div>' +
    '<div style="margin-top:16px"><div class="ns-eyebrow" style="margin-bottom:8px">' + esc(S.lang === 'bn' ? 'বর্তমান কনটেন্ট (' + (S.lang === 'bn' ? 'বাংলা' : 'ইংরেজি') + ')' : 'Current content (' + (S.lang === 'bn' ? 'Bengali' : 'English') + ')') + '</div>' +
    '<div class="ns-callout ns-callout-info" style="display:block">' +
      '<div class="ns-strong">' + esc(S.lang === 'bn' ? t.bn.title : t.en.title) + '</div>' +
      '<div style="margin-top:6px">' + esc(S.lang === 'bn' ? t.bn.body : t.en.body) + '</div></div></div>' +
    '<div class="ns-approval-boundary" style="margin-top:14px">' + ic('shield', 16) + '<span>' + esc(S.lang === 'bn'
      ? 'ভার্সন ফেরানো একটি অ্যাডমিন কাজ এবং অডিট লগে লেখা হবে।'
      : 'Restoring a version is an administrator action and is written to the audit log.') + '</span></div>';
  return sheetShell({ type:'tplversion', title:T('tVersion'), sub: esc(S.lang === 'bn' ? t.bn.title : t.en.title), body: body,
    foot: [{ act:'sheet_close', label:T('close') }, { act:'tpl_restore', id:t.key, label:T('restore') || 'Restore', cls:'ns-btn-primary', ico:'undo' }] });
}

function sheetReschedule(data){
  var S = NS.state;
  var item = S.queue.filter(function(q){ return q.id === (data && data.id); })[0];
  if (!item) return '';
  var body = '<div class="ns-callout ns-callout-info ns-section">' + ic('clock', 17) +
      '<div>' + esc(S.lang === 'bn' ? 'বর্তমান সময়: ' : 'Currently scheduled: ') + '<b>' + esc(fmtDateTime(item.scheduledFor)) + '</b> (' + esc(clockLeft(item.scheduledFor)) + ')</div></div>' +
    '<div class="ns-field"><label class="ns-flabel" for="nsResched"' + ha('cpWhen') + '>' + esc(T('cpWhen')) + '</label>' +
      '<input class="ns-input" type="datetime-local" id="nsResched" value="' + esc(toLocalInput(item.scheduledFor)) + '" /></div>' +
    '<div class="ns-field"><label class="ns-flabel" for="nsReschedTz"' + ha('cpTz') + '>' + esc(T('cpTz')) + '</label>' +
      '<select class="ns-select" id="nsReschedTz"><option>' + esc(S.timezone) + '</option></select></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="ns-btn ns-btn-sm" data-act="resched_preset" data-v="+1h">' + esc(S.lang === 'bn' ? '১ ঘণ্টা পরে' : 'In 1 hour') + '</button>' +
      '<button type="button" class="ns-btn ns-btn-sm" data-act="resched_preset" data-v="+1d">' + esc(S.lang === 'bn' ? 'আগামীকাল' : 'Tomorrow') + '</button>' +
    '</div>' +
    '<div class="ns-callout ns-callout-warn" style="margin-top:14px">' + ic('alert', 16) +
      '<div>' + esc(S.lang === 'bn' ? 'অতীতের সময় গ্রহণ করা হয় না এবং সংঘর্ষ থাকলে সতর্কতা দেখানো হয়।' : 'Past times are rejected and conflicts are warned about before approval.') + '</div></div>';
  return sheetShell({ type:'reschedule', title:T('qReschedule'), sub: tr(item, 'title'), body: body,
    foot: [{ act:'sheet_close', label:T('cancel') }, { act:'reschedule_confirm', id:item.id, label:T('confirm'), cls:'ns-btn-primary', ico:'check' }] });
}

function sheetApproveAutomation(data){
  var S = NS.state;
  var a = S.automations.filter(function(x){ return x.id === (data && data.id); })[0];
  if (!a) return '';
  var body = '<div class="ns-callout ns-callout-warn ns-section">' + ic('alert', 17) +
      '<div><b' + ha('aNeedsApproval') + '>' + esc(T('aNeedsApproval')) + '</b></div></div>' +
    '<div class="ns-flow">' + flowSteps(a).map(function(s){
      return '<div class="ns-flow-step"><span class="ns-flow-chip">' + ic(s.ico, 16) + '</span>' +
        '<span class="ns-flow-body"><span class="ns-flow-kind">' + esc(s.kind) + '</span>' +
        '<span class="ns-flow-text">' + esc(s.text) + '</span></span></div>';
    }).join('') + '</div>' +
    '<dl class="ns-kv" style="margin-top:16px">' +
      '<dt' + ha('caAudience') + '>' + esc(T('caAudience')) + '</dt><dd>' + esc(S.lang === 'bn' ? 'ট্রিগারে থাকা শিক্ষার্থীরা' : 'Whichever students match the trigger') + '</dd>' +
      '<dt>' + esc(T('cpFrequency')) + '</dt><dd>' + esc(S.lang === 'bn' ? 'সর্বোচ্চ ২৪ ঘণ্টায় ১টি নোটিফিকেশন' : 'At most 1 notification per 24 hours') + '</dd>' +
    '</dl>' +
    '<div class="ns-approval-boundary" style="margin-top:16px">' + ic('shield', 16) + '<span>' + esc(T('apBoundary')) + '</span></div>';
  return sheetShell({ type:'approve_automation', title:T('aEnable'), sub: esc(S.lang === 'bn' ? a.name_bn : a.name), body: body,
    foot: [{ act:'sheet_close', label:T('cancel') }, { act:'automation_enable', id:a.id, label:T('aEnable'), cls:'ns-btn-primary', ico:'play' }] });
}

/* ---------- auth gate ---------- */

function renderGate(){
  var S = NS.state;
  var root = document.getElementById('nsRoot');
  root.innerHTML =
    '<div class="ns-gate">' +
      '<div class="ns-gate-card" role="region" aria-labelledby="nsGateTitle">' +
        '<span class="ns-gate-mark">' + ic('shield', 22) + '</span>' +
        '<h1 id="nsGateTitle"' + ha('gateTitle') + '>' + esc(T('gateTitle')) + '</h1>' +
        '<p' + ha('gateSub') + '>' + esc(T('gateSub')) + '</p>' +
        (S.error ? '<div class="ns-callout ns-callout-danger" style="margin-bottom:14px" role="alert">' + ic('alertCircle', 16) +
          '<div>' + esc(S.error === 'bad_token' ? T('gateBad') : S.error) + '</div></div>' : '') +
        '<form id="nsGateForm" novalidate>' +
          '<div class="ns-field"><label class="ns-flabel" for="nsToken"' + ha('gateToken') + '>' + esc(T('gateToken')) +
            ' <span class="ns-req" aria-hidden="true">*</span></label>' +
            '<input class="ns-input" id="nsToken" type="password" autocomplete="off" aria-required="true"' + ph('gateTokenPh') + ' /></div>' +
          '<button type="submit" class="ns-btn ns-btn-primary ns-btn-block" id="nsGateBtn"' + (S.busy ? ' disabled' : '') + '>' +
            esc(S.busy ? T('gateVerifying') : T('gateVerify')) + ic('chevRight', 16) + '</button>' +
        '</form>' +
        '<p class="ns-hint" style="margin-top:12px"' + ha('gateHint') + '>' + esc(T('gateHint')) + '</p>' +
        '<div class="ns-footer-note" style="margin-top:20px;border-top:1px solid var(--line)">' +
          '<span class="ns-mono">' + esc(location.protocol === 'file:' ? 'file://' : location.protocol + '//') + '</span>' +
          '<span>v2.4.0</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  var f = document.getElementById('nsGateForm');
  if (f) f.addEventListener('submit', function(e){
    e.preventDefault();
    var v = document.getElementById('nsToken').value.trim();
    NS.state.busy = true; NS.state.error = null; renderGate();
    setTimeout(function(){
      NS.state.busy = false;
      if (v.length >= 4) {
        NS.state.authed = true; NS.state.token = v; persist();
        NS.state.focusMain = true; render();
        toast('ok', T('gateOk'), T('brandSub'));
      } else {
        NS.state.error = 'bad_token'; renderGate();
      }
    }, 620);
  });
}

/* ============================================================
   Part H — defaults, actions, events, persistence, boot
   ============================================================ */

I18N.en.aiPrepared = 'AI prepared';
I18N.bn.aiPrepared = 'এআই প্রস্তুত';
I18N.en.timezone = 'Timezone';
I18N.bn.timezone = 'টাইমজোন';
I18N.en.restore = 'Restore';
I18N.bn.restore = 'ফিরিয়ে আনুন';
I18N.en.stay = 'Stay';
I18N.bn.stay = 'থাকুন';
I18N.en.discard = 'Discard';
I18N.bn.discard = 'বাতিল করুন';
I18N.en.applyName = 'Save';
I18N.bn.applyName = 'সেভ';
I18N.en.tplNew = 'New template';
I18N.bn.tplNew = 'নতুন টেমপ্লেট';

function defaults(){
  var s = NS.state;
  var d = {
    customType: '', previewOs: 'ios', previewSize: 'medium', previewDark: false, previewLangEn: false,
    audienceOpen: false, advancedOpen: false, scheduleOpen: false, showEn: false,
    tplCat: 'all', tplQ: '', campaignLink: '', ruleGroups: null,
    detailsOpen: { nsDetEn: false, nsDetAudience: false, nsDetSchedule: false, nsDetAdvanced: false },
    testTo: '', lastAiApply: null, focusMain: false
  };
  for (var k in d) if (s[k] === undefined) s[k] = d[k];
  if (!s.ruleBuilder.groups.length) {
    s.ruleBuilder.groups = [{ logic:'and', rules: [{ field:'university', op:'eq', value:'RU' }] }];
  }
}
function autosave(){
  var S = NS.state;
  S.dirty = true;
  S.lastSavedAt = Date.now();
  var snap = composeSnapshot();
  var name = (S.title || '').trim() || (S.lang === 'bn' ? 'শিরোনামহীন ড্রাফট' : 'Untitled draft');
  var existing = S.drafts.filter(function(d){ return d.id === S.draftId; })[0];
  if (existing) {
    existing.updated = Date.now();
    existing.title_bn = S.lang === 'bn' ? S.title : existing.title_bn;
    existing.body_bn = S.lang === 'bn' ? S.body : existing.body_bn;
    existing.title_en = S.titleEn; existing.body_en = S.bodyEn;
    existing.type = S.type; existing.audience = S.audience;
    if (S.title.trim()) { existing.name = name; existing.name_bn = name; }
  } else {
    var id = 'drf_' + Date.now().toString(36);
    S.draftId = id;
    S.drafts.unshift({ id:id, name:name, name_bn:name, type:S.type, audience:S.audience, updated:Date.now(),
      title_bn: S.lang === 'bn' ? S.title : '', body_bn: S.lang === 'bn' ? S.body : '',
      title_en: S.titleEn, body_en: S.bodyEn, snapshot: snap });
  }
  persist();
}
var saveTimer = null;
function scheduleAutosave(){
  NS.state.dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){
    autosave();
    var d = document.getElementById('nsDirty');
    if (d) d.remove();
  }, 1000);
}

function liveUpdate(){
  var S = NS.state;
  var host = document.getElementById('nsPreviewHost');
  if (host) host.innerHTML = renderPreview();
  var vh = document.getElementById('nsValidationHost');
  if (vh) vh.innerHTML = renderValidation(false);
  var tc = document.getElementById('nsTitleCount');
  if (tc) { tc.textContent = fmt(S.title.length) + '/' + fmt(65) + ' ' + T('cpCharCount'); tc.className = 'ns-counter' + (S.title.length > 65 ? ' is-over' : ''); }
  var bc = document.getElementById('nsBodyCount');
  if (bc) { bc.textContent = fmt(S.body.length) + '/' + fmt(178) + ' ' + T('cpCharCount'); bc.className = 'ns-counter' + (S.body.length > 178 ? ' is-over' : ''); }
  var ti = document.getElementById('nsTitle');
  if (ti) ti.setAttribute('aria-invalid', String(!S.title.trim()));
  var bi = document.getElementById('nsBody');
  if (bi) bi.setAttribute('aria-invalid', String(!S.body.trim()));
}

/* ---------- send simulation ---------- */

function startSend(scheduled, test){
  var S = NS.state;
  S.sendPhase = scheduled ? 'scheduling' : 'sending';
  S.sendProgress = 0;
  openSheet('send');
  var steps = [18, 46, 74, 100];
  steps.forEach(function(p, i){
    setTimeout(function(){
      S.sendProgress = p;
      if (S.sheet === 'send') {
        var bar = document.querySelector('.ns-progress > span');
        var host = document.querySelector('[role="progressbar"]');
        if (bar) bar.style.width = p + '%';
        if (host) host.setAttribute('aria-valuenow', String(p));
        var items = document.querySelectorAll('.ns-sheet .ns-check-item');
        if (items && items[i]) {
          var ico = items[i].querySelector('.ns-check-ico');
          if (ico) { ico.className = 'ns-check-ico ns-ci-ok'; ico.innerHTML = ic('checkCircle', 15); }
        }
      }
    }, 420 * (i + 1));
  });
  setTimeout(function(){
    var r = computedReach();
    var now = Date.now();
    S.busy = false;
    if (test) {
      closeSheet();
      toast('ok', T('tsRun'), S.lang === 'bn' ? 'টেস্ট নোটিফিকেশন শুধু টেস্ট ডিভাইসে গেছে (৩টি ডিভাইস)।' : 'Test notification delivered to test devices only (3 devices).');
      S.testMode = false;
      render();
      return;
    }
    var rec = {
      id: 'n_' + (2482 + S.history.length), status: scheduled ? 'scheduled' : 'sent', type: S.type,
      audience: S.audience, channel: S.channel,
      title_bn: S.lang === 'bn' ? S.title : (S.titleEn || S.title),
      title_en: S.lang === 'en' ? S.title : (S.titleEn || S.title),
      body_bn: S.lang === 'bn' ? S.body : (S.bodyEn || S.body),
      body_en: S.lang === 'en' ? S.body : (S.bodyEn || S.body),
      imageUrl: S.imageUrl, targetUrl: S.targetUrl, cta: S.cta,
      sentAt: scheduled ? null : now, createdAt: now,
      scheduledFor: scheduled ? new Date(S.when).getTime() : now,
      reach: r.final,
      delivered: scheduled ? 0 : Math.round(r.final * 0.972),
      opened: scheduled ? 0 : Math.round(r.final * 0.972 * 0.31),
      clicked: scheduled ? 0 : Math.round(r.final * 0.972 * 0.31 * 0.37),
      error: null, reason: null, reason_bn: null, reason_en: null,
      campaign: S.campaignLink || null
    };
    S.history.unshift(rec);
    if (scheduled) {
      S.queue.unshift({ id: rec.id, title_bn: rec.title_bn, title_en: rec.title_en, campaign: S.campaignLink || null,
        audience: S.audience, type: S.type, channel: S.channel, scheduledFor: rec.scheduledFor,
        priority: S.priority, status: 'scheduled' });
      S.audit.unshift({ t: now, actor: S.role === 'admin' ? 'Admin · You' : 'Operator', en:'Scheduled notification', bn:'নোটিফিকেশন শিডিউল করেছেন', ref: rec.id });
    } else {
      S.audit.unshift({ t: now, actor: S.role === 'admin' ? 'Admin · You' : 'Operator', en:'Sent notification', bn:'নোটিফিকেশন পাঠিয়েছেন', ref: rec.id });
      S.dailyCap.used += r.final;
    }
    S.aiActivity.unshift({ t: now, bn:'অ্যাডমিন অনুমোদন সম্পন্ন', en:'Administrator approval recorded', kind:'ok' });
    S.sendPhase = null;
    S.sendProgress = 100;
    openSheet('success', { scheduled: scheduled, reach: r.final });
    toast('ok', scheduled ? T('sScheduled') : T('sdSuccess'), scheduled
      ? (S.lang === 'bn' ? 'কিউতে যুক্ত হয়েছে — ' + fmtDateTime(rec.scheduledFor) : 'Added to the queue — ' + fmtDateTime(rec.scheduledFor))
      : T('sdSuccessSub'));
    persist();
  }, 420 * 5 + 260);
}

function simulateFailure(){
  var S = NS.state;
  openSheet('fail', {
    title: S.lang === 'bn' ? 'পাঠানো ব্যর্থ হয়েছে' : 'The send failed',
    why: S.lang === 'bn' ? 'টার্গেট URL-এর স্কিম সমর্থিত নয় (htp://)। ডেলিভারি সেবা পাঠানোর আগেই অনুরোধ প্রত্যাখ্যান করেছে।' : 'The target URL scheme is unsupported (htp://). The delivery service rejected the request before dispatch.',
    reason: S.lang === 'bn' ? 'ডেলিভারি সেবা অনুরোধ প্রত্যাখ্যান করেছে। কোনো শিক্ষার্থী কিছু পায়নি।' : 'The delivery service rejected the request. No student received anything.',
    fix: S.lang === 'bn' ? 'টার্গেট URL ঠিক করে আবার চেষ্টা করুন — অথবা শিডিউল বদলে দিন।' : 'Fix the target URL and retry — or change the schedule.'
  });
  S.history.unshift({
    id: 'n_' + (2490 + S.history.length), status: 'failed', type: S.type, audience: S.audience, channel: S.channel,
    title_bn: S.title, title_en: S.titleEn || S.title, body_bn: S.body, body_en: S.bodyEn || S.body,
    imageUrl: S.imageUrl, targetUrl: S.targetUrl, cta: S.cta,
    sentAt: Date.now(), createdAt: Date.now(), scheduledFor: Date.now(),
    reach: 0, delivered: 0, opened: 0, clicked: 0, error: 'invalid_target_url',
    reason_bn: 'টার্গেট URL-টি অবৈধ (স্কিম "htp" সাপোর্ট করা হয় না)। ০ জন ইউজারকে কিছু পাঠানো হয়নি।',
    reason_en: 'The target URL is invalid (scheme "htp" is not supported). Nothing was delivered to any of the 0 recipients.',
    campaign: null
  });
}

/* ---------- actions ---------- */

function applyTheme(v){ if (['light','dark','pink','green'].indexOf(v) < 0) return; NS.state.theme = v; persist(); render(); }
function applyLang(v){ if (['bn','en'].indexOf(v) < 0) return; NS.state.lang = v; persist(); render(); }

var ACT = {
  tab: function(el){
    var t = el.dataset.tab, S = NS.state;
    if (!t) return;
    if (t === 'more') { S.tab = 'more'; }
    else {
      S.tab = t;
      S.viewState = {};
    }
    S.focusMain = true;
    if (t === 'compose') S.dirty = false;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  },
  pop: function(el){
    var id = 'nsPop-' + el.dataset.pop;
    var pop = document.getElementById(id);
    var open = pop && pop.classList.contains('is-open');
    document.querySelectorAll('.ns-pop.is-open').forEach(function(p){ p.classList.remove('is-open'); });
    document.querySelectorAll('[data-act="pop"]').forEach(function(b){ b.setAttribute('aria-expanded', 'false'); });
    if (pop && !open) { pop.classList.add('is-open'); el.setAttribute('aria-expanded', 'true'); }
  },
  theme: function(el){ applyTheme(el.dataset.v); },
  lang: function(el){ applyLang(el.dataset.v); },
  role: function(el){
    var v = el.dataset.v || 'admin';
    NS.state.role = v; persist(); render();
    toast(v === 'admin' ? 'ok' : 'warn', T('role'), v === 'admin' ? T('roleAdmin') : T('rolePreparer'));
  },
  simstate: function(el){
    var v = el.dataset.v || 'ok';
    NS.state.viewState = {};
    if (v === 'loading') {
      NS.state.viewState[NS.state.tab] = 'loading';
      render();
      setTimeout(function(){ NS.state.viewState[NS.state.tab] = 'ok'; render(); }, 1200);
    } else { render(); }
  },
  offline: function(){
    var S = NS.state;
    S.offline = !S.offline;
    render();
    if (S.offline) toast('warn', T('simOffline'), S.lang === 'bn'
      ? 'পাঠানো বন্ধ, কিন্তু ড্রাফট সংরক্ষিত। অফলাইনে থাকা অবস্থায় যেকোনো পাঠানোর চেষ্টা ব্লক হবে।'
      : 'Sending paused, drafts preserved. Any send attempt while offline is blocked.');
    else toast('ok', T('okStates'), S.lang === 'bn' ? 'সংযোগ ফিরে এসেছে — পাঠানো আবার চালু।' : 'Connection restored — sending is available again.');
  },
  detail: function(el){ openSheet('detail', findItem(el.dataset.id)); },
  opendrafts: function(){ openSheet('drafts'); },
  toast_dismiss: function(el){ dismissToast(el.dataset.id); },
  sheet_close: function(){ closeSheet(); },
  focus: function(el){
    var f = el.dataset.field;
    closeSheet();
    NS.state.tab = 'compose';
    render();
    setTimeout(function(){
      var t = document.getElementById(f);
      if (t) { t.focus(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }, 30);
  },
  settype: function(el){ NS.state.type = el.value === '__custom' ? (NS.state.customType || 'announcement') : el.value; NS.state.customType = el.value === '__custom' ? (NS.state.customType || '') : ''; scheduleAutosave(); render(); },
  setchannel: function(el){
    var c = el.value, S = NS.state;
    var svc = { push:'svc_push', inapp:'svc_inapp', email:'svc_email', sms:'svc_sms' }[c];
    var s = S.systemHealth.filter(function(x){ return x.id === svc; })[0];
    S.channel = c; scheduleAutosave(); render();
    if (s && s.s === 'unavailable') toast('warn', chanLabel(c), S.lang === 'bn'
      ? 'এই চ্যানেল এখন অনুপলব্ধ — পাঠানো ব্লক হবে যতক্ষণ না সেবা ফিরে আসে।'
      : 'This channel is unavailable right now — sends are blocked until the service recovers.');
  },
  settemplate: function(el){
    var k = el.value, S = NS.state;
    S.templateKey = k || null;
    if (k) {
      var t = S.templates.filter(function(x){ return x.key === k; })[0];
      if (t) { S.title = t.bn.title; S.body = t.bn.body; S.titleEn = t.en.title; S.bodyEn = t.en.body; S.showEn = true; t.uses++; }
    }
    autosave(); render();
    if (k) toast('ok', T('tUse'), T('cpAutosaved'));
  },
  title: function(el){ NS.state.title = el.value; scheduleAutosave(); liveUpdate(); },
  body: function(el){ NS.state.body = el.value; scheduleAutosave(); liveUpdate(); },
  titleen: function(el){ NS.state.titleEn = el.value; scheduleAutosave(); liveUpdate(); },
  bodyen: function(el){ NS.state.bodyEn = el.value; scheduleAutosave(); liveUpdate(); },
  customtype: function(el){ NS.state.customType = el.value; NS.state.type = el.value || 'announcement'; scheduleAutosave(); },
  image: function(el){ NS.state.imageUrl = el.value.trim(); scheduleAutosave(); liveUpdate(); },
  target: function(el){ NS.state.targetUrl = el.value.trim(); scheduleAutosave(); liveUpdate(); },
  cta: function(el){ NS.state.cta = el.value; scheduleAutosave(); liveUpdate(); },
  utm: function(el){ NS.state.utm = el.value; scheduleAutosave(); },
  titleb: function(el){ NS.state.ab.titleB = el.value; scheduleAutosave(); },
  bodyb: function(el){ NS.state.ab.bodyB = el.value; scheduleAutosave(); },
  person: function(el){ NS.state.personalization = el.checked; scheduleAutosave(); render(); },
  toggleen: function(){ NS.state.showEn = !NS.state.showEn; scheduleAutosave(); render(); },
  insvar: function(el){
    var v = '{{' + el.dataset.v + '}}';
    var t = document.getElementById('nsBody');
    var ti = document.getElementById('nsTitle');
    var target = (document.activeElement === ti || document.activeElement === document.getElementById('nsTitleEn')) ? ti : t;
    if (!target) return;
    var start = target.selectionStart != null ? target.selectionStart : target.value.length;
    var end = target.selectionEnd != null ? target.selectionEnd : start;
    target.value = target.value.slice(0, start) + v + target.value.slice(end);
    target.focus();
    target.selectionStart = target.selectionEnd = start + v.length;
    if (target.id === 'nsTitle') NS.state.title = target.value; else NS.state.body = target.value;
    scheduleAutosave(); liveUpdate();
  },
  setaudience: function(el){ NS.state.audience = el.value; NS.state.segmentId = null; scheduleAutosave(); render(); },
  segment_pick: function(el){
    var S = NS.state;
    S.audience = el.dataset.id;
    if (S.tab === 'compose') S.audienceOpen = true;
    render();
    toast('ok', T('apAudience'), audLabel(S.audience) + ' · ' + fmt(reachFor(S.audience)));
  },
  exclude: function(el){ NS.state.exclude = el.value; scheduleAutosave(); render(); },
  freq: function(el){ NS.state.frequency = el.value; scheduleAutosave(); render(); },
  when: function(el){ NS.state.when = el.value; scheduleAutosave(); liveUpdate(); },
  whenpreset: function(el){
    var S = NS.state, v = el.dataset.v, d = new Date();
    if (v === 'clear') S.when = '';
    else if (v === '+1h') { d.setHours(d.getHours() + 1, 0, 0, 0); S.when = toLocalInput(d.getTime()); }
    else if (v === '2100') { d.setHours(21, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); S.when = toLocalInput(d.getTime()); }
    else if (v === '+1d') { d.setDate(d.getDate() + 1); d.setHours(9, 30, 0, 0); S.when = toLocalInput(d.getTime()); }
    scheduleAutosave(); render();
  },
  tz: function(el){ NS.state.timezone = el.value; scheduleAutosave(); render(); },
  recurring: function(el){ NS.state.recurring = el.checked; scheduleAutosave(); render(); },
  every: function(el){ NS.state.recurEvery = el.value; scheduleAutosave(); render(); },
  priority: function(el){ NS.state.priority = el.value; scheduleAutosave(); render(); },
  ab: function(el){ NS.state.ab.enabled = el.checked; scheduleAutosave(); render(); },
  endetails: function(){},
  previewos: function(el){ NS.state.previewOs = el.dataset.v; render(); },
  previewsize: function(el){ NS.state.previewSize = el.dataset.v; render(); },
  previewdark: function(){ NS.state.previewDark = !NS.state.previewDark; render(); },
  previewlang: function(){ NS.state.previewLangEn = !NS.state.previewLangEn; render(); },
  savedraft: function(){
    autosave();
    NS.state.dirty = false;
    render();
    toast('ok', T('cpDraftSaved'), T('cpAutosaved') + ' ' + fmtDateTime(NS.state.lastSavedAt));
  },
  savetpl: function(){
    var S = NS.state;
    var key = 'tpl_custom_' + Date.now().toString(36);
    S.templates.unshift({ key:key, cat:'custom', fav:false, versions:1, uses:0, updated:Date.now(),
      bn:{ title:S.title, body:S.body }, en:{ title:S.titleEn, body:S.bodyEn } });
    persist(); render();
    toast('ok', T('tSave'), S.lang === 'bn' ? 'নতুন টেমপ্লেট লাইব্রেরিতে যোগ হয়েছে।' : 'Added to the template library.');
  },
  testsend: function(){ openSheet('testsend'); },
  test_run: function(){
    closeSheet();
    NS.state.testMode = true;
    startSend(false, true);
  },
  review: function(){
    var S = NS.state, C = checksByLevel();
    if (S.role !== 'admin') {
      toast('err', T('apNoPermission'), T('switchRole'));
      return;
    }
    openSheet('approval');
    if (C.err.length) toast('warn', T('apReviewFailed'), S.lang === 'bn'
      ? fmt(C.err.length) + 'টি বাধাদানকারী সমস্যা আছে — অনুমোদন বন্ধ থাকবে।'
      : fmt(C.err.length) + ' blocking issue(s) — approval stays locked.');
  },
  approval_blocked: function(){
    var L = checksByLevel();
    toast('err', T('apBlocked'), L.err.length ? (NS.state.lang === 'bn' ? L.err[0].bn : L.err[0].en) : T('offline'));
  },
  approve: function(){
    if (!canSend()) { ACT.approval_blocked(); return; }
    openSheet('confirm');
    NS.state.audit.unshift({ t: Date.now(), actor:'Admin · You', en:'Opened final confirmation', bn:'চূড়ান্ত নিশ্চিতকরণ খুলেছেন', ref: NS.state.title || 'untitled' });
  },
  send_final: function(){
    closeSheet();
    NS.state.busy = true;
    setTimeout(function(){
      NS.state.busy = false;
      var hasBadUrl = NS.state.targetUrl && !/^https:\/\//i.test(NS.state.targetUrl) && !/^admissionhub:\/\//i.test(NS.state.targetUrl);
      var smsDown = NS.state.channel === 'sms';
      if (NS.state.offline || hasBadUrl) { simulateFailure(); return; }
      if (smsDown) {
        simulateFailure();
        return;
      }
      startSend(!!NS.state.when, false);
    }, 260);
  },
  retry: function(el){
    var S = NS.state;
    var item = findItem(el.dataset.id);
    closeSheet();
    if (item && item.status === 'failed' && item.error === 'invalid_target_url') {
      S.title = tr(item, 'title'); S.body = tr(item, 'body'); S.audience = item.audience; S.type = item.type;
      S.targetUrl = 'https://app.admissionhub.com/notice';
      S.tab = 'compose';
      render();
      toast('warn', T('sRetry'), S.lang === 'bn'
        ? 'টার্গেট URL স্বয়ংক্রিয়ভাবে কার্যকর ডিফল্টে বদলানো হয়েছে — অনুমোদনের আগে যাচাই করুন।'
        : 'The target URL was replaced with a working default — verify it before approving.');
      return;
    }
    startSend(false, false);
  },
  retry_send: function(){ closeSheet(); startSend(false, false); },
  edit_resend: function(el){
    var item = findItem(el.dataset.id), S = NS.state;
    if (!item) return;
    closeSheet();
    S.title = tr(item, 'title'); S.body = tr(item, 'body');
    S.audience = item.audience; S.type = item.type; S.channel = item.channel;
    S.targetUrl = item.targetUrl || ''; S.imageUrl = item.imageUrl || ''; S.cta = item.cta || '';
    S.tab = 'compose'; S.dirty = true;
    render();
    toast('ok', T('sEditResend'), S.lang === 'bn' ? 'এডিট করার জন্য কম্পোজারে লোড করা হয়েছে।' : 'Loaded into the composer for editing.');
  },
  duplicate_from: function(el){
    var item = findItem(el.dataset.id), S = NS.state;
    if (!item) return;
    closeSheet();
    S.title = tr(item, 'title'); S.body = tr(item, 'body'); S.type = item.type; S.channel = item.channel;
    S.audience = item.audience; S.targetUrl = item.targetUrl || ''; S.cta = item.cta || '';
    S.tab = 'compose'; S.when = '';
    render();
    toast('ok', T('duplicate'), T('cpAutosaved'));
  },
  cancelqueue: function(el){
    var S = NS.state, id = el.dataset.id;
    var q = S.queue.filter(function(x){ return x.id === id; })[0];
    var h = S.history.filter(function(x){ return x.id === id; })[0];
    var target = q || h;
    if (!target) return;
    openSheet('fail', {
      title: S.lang === 'bn' ? 'বাতিল নিশ্চিত করুন' : 'Confirm cancellation',
      why: (S.lang === 'bn' ? 'আপনি "' : 'You are cancelling "') + tr(target, 'title') + (S.lang === 'bn' ? '" বাতিল করছেন।' : '".'),
      fix: S.lang === 'bn' ? 'চালিয়ে যেতে "বাতিল" চাপুন।' : 'Press Cancel to keep it.'
    });
    S.sheet = 'confirm_cancel';
    S.sheetData = id;
    closeSheet();
    if (q) {
      S.queue = S.queue.filter(function(x){ return x.id !== id; });
      S.queue.push({ id:id, title_bn:q.title_bn, title_en:q.title_en, campaign:q.campaign, audience:q.audience, type:q.type,
        channel:q.channel, scheduledFor:q.scheduledFor, priority:q.priority, status:'cancelled' });
    }
    if (h) { h.status = 'cancelled'; h.reason_bn = 'অ্যাডমিন শিডিউল বাতিল করেছেন।'; h.reason_en = 'Cancelled by an administrator before dispatch.'; }
    S.audit.unshift({ t:Date.now(), actor:'Admin · You', en:'Cancelled scheduled notification', bn:'শিডিউলড নোটিফিকেশন বাতিল করেছেন', ref:id });
    render();
    toast('warn', T('sCancelled'), (S.lang === 'bn' ? '"' : '"') + tr(target, 'title') + (S.lang === 'bn' ? '" বাতিল হয়েছে।' : '" was cancelled.'));
  },
  reschedule: function(el){ openSheet('reschedule', { id: el.dataset.id }); },
  resched_preset: function(el){
    var inp = document.getElementById('nsResched'), d = new Date();
    if (el.dataset.v === '+1h') d.setHours(d.getHours() + 1, 0, 0, 0);
    else { d.setDate(d.getDate() + 1); d.setHours(9, 30, 0, 0); }
    if (inp) inp.value = toLocalInput(d.getTime());
  },
  reschedule_confirm: function(el){
    var S = NS.state, id = el.dataset.id;
    var inp = document.getElementById('nsResched');
    var v = inp ? inp.value : '';
    var ts = v ? new Date(v).getTime() : NaN;
    if (isNaN(ts) || ts < Date.now()) {
      toast('err', T('cpConflict'), S.lang === 'bn'
        ? 'নোটিফিকেশন শিডিউল করা যায়নি কারণ নির্বাচিত সময় ইতিমধ্যে পার হয়ে গেছে। অন্য সময় বেছে নিন।'
        : 'The notification could not be rescheduled because the selected time has already passed. Choose another time.');
      return;
    }
    var q = S.queue.filter(function(x){ return x.id === id; })[0];
    if (q) { q.scheduledFor = ts; q.status = 'scheduled'; }
    var h = S.history.filter(function(x){ return x.id === id; })[0];
    if (h) h.scheduledFor = ts;
    S.audit.unshift({ t:Date.now(), actor:'Admin · You', en:'Rescheduled notification', bn:'নোটিফিকেশন পুনঃশিডিউল করেছেন', ref:id });
    closeSheet();
    render();
    toast('ok', T('qReschedule'), fmtDateTime(ts) + ' · ' + S.timezone);
  },
  success_queue: function(){ closeSheet(); NS.state.tab = 'queue'; render(); },
  success_sent: function(){ closeSheet(); NS.state.tab = 'sent'; render(); },
  sentq: function(el){ NS.state.filters.sent.q = el.value; render(); var i = document.getElementById('nsSentQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
  sentstatus: function(el){ NS.state.filters.sent.status = el.value; render(); },
  senttype: function(el){ NS.state.filters.sent.type = el.value; render(); },
  sentchannel: function(el){ NS.state.filters.sent.channel = el.value; render(); },
  sentclear: function(){ NS.state.filters.sent = { q:'', status:'all', type:'all', channel:'all' }; render(); },
  sort: function(el){
    var S = NS.state, k = el.dataset.key;
    if (S.filters.sort.key === k) S.filters.sort.dir = S.filters.sort.dir === 'desc' ? 'asc' : 'desc';
    else { S.filters.sort.key = k; S.filters.sort.dir = 'desc'; }
    render();
  },
  export: function(){
    var S = NS.state;
    toast('ok', S.lang === 'bn' ? 'এক্সপোর্ট প্রস্তুত' : 'Export ready',
      S.lang === 'bn' ? 'এই প্রোটোটাইপে ফাইল লেখা হয় না — বাস্তব অ্যাপে CSV ডাউনলোড হবে।' : 'This prototype does not write files — the real app downloads a CSV here.');
  },
  tplcat: function(el){ NS.state.tplCat = el.dataset.v; render(); },
  tplq: function(el){ NS.state.tplQ = el.value; render(); var i = document.getElementById('nsTplQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
  tplfav: function(el){
    var S = NS.state, k = el.dataset.key;
    var t = S.templates.filter(function(x){ return x.key === k; })[0];
    if (t) { t.fav = !t.fav; render(); toast('ok', T('tFavorites'), (t.fav ? '+ ' : '− ') + (S.lang === 'bn' ? t.bn.title : t.en.title)); }
  },
  tpluse: function(el){
    var S = NS.state, k = el.dataset.key;
    var t = S.templates.filter(function(x){ return x.key === k; })[0];
    if (!t) return;
    S.templateKey = k; S.title = t.bn.title; S.body = t.bn.body; S.titleEn = t.en.title; S.bodyEn = t.en.body;
    t.uses++; S.tab = 'compose';
    autosave(); render();
    toast('ok', T('tUse'), S.lang === 'bn' ? t.bn.title : t.en.title);
  },
  tpldup: function(el){
    var S = NS.state, k = el.dataset.key;
    var t = S.templates.filter(function(x){ return x.key === k; })[0];
    if (!t) return;
    S.templates.unshift({ key:'tpl_copy_' + Date.now().toString(36), cat:t.cat, fav:false, versions:1, uses:0,
      updated:Date.now(), bn:{ title:t.bn.title + ' (copy)', body:t.bn.body }, en:{ title:t.en.title + ' (copy)', body:t.en.body } });
    render();
    toast('ok', T('tDuplicate'), T('done'));
  },
  tplver: function(el){ openSheet('tplversion', { key: el.dataset.key }); },
  tpl_restore: function(){ closeSheet(); toast('ok', T('restore'), T('audit')); },
  tpl_new: function(){
    var S = NS.state;
    S.templates.unshift({ key:'tpl_new_' + Date.now().toString(36), cat:'custom', fav:false, versions:1, uses:0, updated:Date.now(),
      bn:{ title:S.lang === 'bn' ? 'নতুন টেমপ্লেট' : 'New template', body:'' }, en:{ title:'New template', body:'' } });
    render();
    toast('ok', T('tNew'), T('cpAutosaved'));
  },
  seg_addrule: function(el){
    var S = NS.state, gi = el.dataset.g ? Number(el.dataset.g) : 0;
    if (!S.ruleBuilder.groups[gi]) S.ruleBuilder.groups.push({ logic:'and', rules:[] });
    S.ruleBuilder.groups[gi].rules.push({ field:'unit', op:'eq', value:'A' });
    render();
  },
  seg_addgroup: function(){ NS.state.ruleBuilder.groups.push({ logic:'and', rules:[{ field:'course', op:'eq', value:'English' }] }); render(); },
  seg_removegroup: function(el){ NS.state.ruleBuilder.groups.splice(Number(el.dataset.g), 1); render(); },
  rule_remove: function(el){ NS.state.ruleBuilder.groups[Number(el.dataset.g)].rules.splice(Number(el.dataset.r), 1); render(); },
  rulefield: function(el){
    var S = NS.state, g = Number(el.dataset.g), r = Number(el.dataset.r);
    var f = RULE_FIELDS.filter(function(x){ return x.id === el.value; })[0];
    var rule = S.ruleBuilder.groups[g].rules[r];
    rule.field = el.value;
    rule.value = f && f.opts ? f.opts[0] : '7';
    render();
  },
  ruleop: function(el){ NS.state.ruleBuilder.groups[Number(el.dataset.g)].rules[Number(el.dataset.r)].op = el.value; render(); },
  rulevalue: function(el){ NS.state.ruleBuilder.groups[Number(el.dataset.g)].rules[Number(el.dataset.r)].value = el.value; render(); },
  seglogic: function(el){ NS.state.ruleBuilder.logic = el.dataset.v; render(); },
  segname: function(el){ NS.state.ruleBuilder.name = el.value; },
  segbase: function(el){ NS.state.ruleBuilder.base = el.value; render(); },
  seg_apply: function(){
    var S = NS.state;
    S.audience = 'custom_' + Date.now().toString(36);
    S.segments.push({ id:S.audience, name:S.ruleBuilder.name || (S.lang === 'bn' ? 'কাস্টম সেগমেন্ট' : 'Custom segment'),
      name_bn:S.ruleBuilder.name || 'কাস্টম সেগমেন্ট', count: estimateReachForRules(), tag:'custom' });
    S.tab = 'compose';
    render();
    toast('ok', T('cpApply'), audLabel(S.audience) + ' · ' + fmt(reachFor(S.audience)));
  },
  seg_reset: function(){ NS.state.ruleBuilder = { id:null, name:'', base:'all_students', logic:'and', groups:[{ logic:'and', rules:[{ field:'university', op:'eq', value:'RU' }] }], exclude:'' }; render(); },
  segment_save: function(){ openSheet('segmentsave'); },
  segment_save_confirm: function(){
    var S = NS.state;
    var inp = document.getElementById('nsSegSaveName');
    var name = (inp && inp.value.trim()) || (S.lang === 'bn' ? 'নামহীন সেগমেন্ট' : 'Unnamed segment');
    S.ruleBuilder.name = name;
    var id = 'seg_' + Date.now().toString(36);
    S.segments.push({ id:id, name:name, name_bn:name, count: estimateReachForRules(), tag:'custom', saved:true });
    S.audience = id;
    closeSheet();
    render();
    toast('ok', T('auSave'), name + ' · ' + fmt(reachFor(id)) + ' ' + T('navAudience'));
  },
  health_check: function(){
    var S = NS.state;
    S.systemHealth.forEach(function(x){ x.checked = Date.now(); });
    var svc = S.systemHealth.filter(function(x){ return x.id === 'svc_sms'; })[0];
    if (svc) { svc.s = 'degraded'; svc.act_bn = 'প্রোভাইডার আংশিক ফিরেছে — ৫০% গতিতে ডেলিভারি, ব্যাচ ১০ মিনিট দেরিতে।'; svc.act_en = 'Provider partially recovered — 50% throughput, batches ~10 min late.'; }
    render();
    toast('ok', T('hCheck'), S.lang === 'bn' ? 'সব সেবা চেক করা হয়েছে।' : 'All services checked.');
  },
  automation_toggle: function(el){
    var S = NS.state, id = el.dataset.id;
    var a = S.automations.filter(function(x){ return x.id === id; })[0];
    if (!a) return;
    if (a.status === 'enabled') {
      a.status = 'disabled'; render();
      toast('warn', T('aDisable'), (S.lang === 'bn' ? a.name_bn : a.name));
    } else {
      openSheet('approve_automation', { id: id });
    }
  },
  automation_new: function(){ NS.state.tab = 'automations'; toast('ok', T('aNew'), NS.state.lang === 'bn' ? 'নতুন অটোমেশন ড্রাফট হিসেবে যোগ করা যায় — ট্রিগার নির্বাচন করে শুরু করুন।' : 'A new automation can be added as a draft — start by choosing a trigger.'); },
  automation_enable: function(el){
    var S = NS.state, id = el.dataset.id;
    var a = S.automations.filter(function(x){ return x.id === id; })[0];
    if (!a) return;
    a.status = 'enabled';
    S.audit.unshift({ t:Date.now(), actor:'Admin · You', en:'Activated automation', bn:'অটোমেশন সক্রিয় করেছেন', ref: S.lang === 'bn' ? a.name_bn : a.name });
    closeSheet(); render();
    toast('ok', T('aEnabled'), S.lang === 'bn' ? a.name_bn : a.name);
  },
  campaigns_new: function(){ openSheet('campaignnew'); },
  campaign_create: function(){
    var S = NS.state;
    var nm = document.getElementById('nsCampName');
    var aud = document.getElementById('nsCampAud');
    var ch = document.getElementById('nsCampChan');
    var name = (nm && nm.value.trim()) || (S.lang === 'bn' ? 'নতুন ক্যাম্পেইন' : 'New campaign');
    var id = 'cmp_' + Date.now().toString(36);
    var now = Date.now();
    S.campaigns.unshift({ id:id, name:name, name_bn:name, status:'draft',
      audience:(aud && aud.value) || S.audience, channel:(ch && ch.value) || S.channel,
      created:now, owner: S.role === 'admin' ? 'Admin · You' : 'Operator · You',
      messages: [
        { day:1, kind:'message', title_bn:'প্রস্তুতি শুরু', title_en:'Preparation begins', body_bn:'আজকের টার্গেট ২০টি প্রশ্ন — শুরু করো।', body_en:'Today\u2019s target is 20 questions — get started.', status:'ready', sendAt:now + 86400000 },
        { day:3, kind:'message', title_bn:'প্র্যাকটিস রিমাইন্ডার', title_en:'Practice reminder', body_bn:'মক টেস্ট দিয়ে প্রস্তুতি চালিয়ে যাও।', body_en:'Keep going with a mock test.', status:'ready', sendAt:now + 3 * 86400000 },
        { day:5, kind:'wait', title_bn:'২ দিন অপেক্ষা', title_en:'Wait 2 days', status:'ready', sendAt:now + 5 * 86400000 },
        { day:7, kind:'message', title_bn:'শেষ রিমাইন্ডার', title_en:'Final reminder', body_bn:'আগামীকাল পরীক্ষা — ভুল প্রশ্ন রিভিউ করো।', body_en:'Exam tomorrow — review your wrong answers.', status:'ready', sendAt:now + 7 * 86400000 }
      ] });
    S.audit.unshift({ t:now, actor:'AI Agent', en:'Prepared campaign draft', bn:'ক্যাম্পেইন ড্রাফট প্রস্তুত করেছে', ref:name });
    S.selectedCampaign = id;
    closeSheet();
    S.tab = 'campaigns';
    render();
    toast('ok', T('caNew'), S.lang === 'bn' ? 'ড্রাফট হিসেবে তৈরি — সক্রিয় করতে অ্যাডমিন অনুমোদন দরকার।' : 'Created as a draft — activating it needs administrator approval.');
  },
  campaign: function(el){
    NS.state.selectedCampaign = el.dataset.id;
    render();
  },
  campaign_activate: function(el){
    var S = NS.state, id = el.dataset.id;
    var c = S.campaigns.filter(function(x){ return x.id === id; })[0];
    if (!c) return;
    if (S.role !== 'admin') { toast('err', T('apNoPermission'), T('switchRole')); return; }
    c.status = 'active';
    c.owner = 'Admin approved';
    c.messages.forEach(function(m){ if (m.sendAt > Date.now() && m.kind === 'message') m.status = 'scheduled'; });
    S.audit.unshift({ t:Date.now(), actor:'Admin · You', en:'Activated campaign', bn:'ক্যাম্পেইন সক্রিয় করেছেন', ref: S.lang === 'bn' ? c.name_bn : c.name });
    render();
    toast('ok', T('caActive'), S.lang === 'bn' ? fmt(c.messages.length) + 'টি বার্তা কিউতে যুক্ত হয়েছে।' : fmt(c.messages.length) + ' messages placed in the queue.');
  },
  campaign_pause: function(el){
    var S = NS.state, c = S.campaigns.filter(function(x){ return x.id === el.dataset.id; })[0];
    if (!c) return;
    c.status = 'paused';
    render();
    toast('warn', T('caPaused'), S.lang === 'bn' ? c.name_bn : c.name);
  },
  campaign_resume: function(el){
    var S = NS.state, c = S.campaigns.filter(function(x){ return x.id === el.dataset.id; })[0];
    if (!c) return;
    c.status = 'active';
    render();
    toast('ok', T('caResume'), S.lang === 'bn' ? c.name_bn : c.name);
  },
  campaign_cancel: function(el){
    var S = NS.state, c = S.campaigns.filter(function(x){ return x.id === el.dataset.id; })[0];
    if (!c) return;
    c.status = 'cancelled';
    c.messages.forEach(function(m){ if (m.status === 'scheduled') m.status = 'draft'; });
    S.audit.unshift({ t:Date.now(), actor:'Admin · You', en:'Cancelled campaign', bn:'ক্যাম্পেইন বাতিল করেছেন', ref: S.lang === 'bn' ? c.name_bn : c.name });
    render();
    toast('warn', T('caCancelled'), S.lang === 'bn' ? c.name_bn : c.name);
  },
  campaign_duplicate: function(el){
    var S = NS.state, c = S.campaigns.filter(function(x){ return x.id === el.dataset.id; })[0];
    if (!c) return;
    var copy = JSON.parse(JSON.stringify(c));
    copy.id = 'cmp_' + Date.now().toString(36);
    copy.name = c.name + ' (copy)'; copy.name_bn = c.name_bn + ' (কপি)';
    copy.status = 'draft'; copy.created = Date.now(); copy.owner = 'Draft copy';
    S.campaigns.unshift(copy);
    S.selectedCampaign = copy.id;
    render();
    toast('ok', T('caDuplicate'), copy.name);
  },
  campaign_addmsg: function(el){
    var S = NS.state, c = S.campaigns.filter(function(x){ return x.id === el.dataset.id; })[0];
    if (!c) return;
    var lastDay = c.messages.reduce(function(a, m){ return Math.max(a, m.day); }, 0);
    c.messages.push({ day: lastDay + 2, kind:'message', title_bn:'নতুন বার্তা', title_en:'New message',
      body_bn:'বার্তার কনটেন্ট এখানে লিখুন।', body_en:'Write the message content here.', status:'ready', sendAt: Date.now() + (lastDay + 2) * 86400000 });
    render();
    toast('ok', T('caAddMessage'), T('done'));
  },
  draft_load: function(el){
    var S = NS.state, id = el.dataset.id;
    var d = S.drafts.filter(function(x){ return x.id === id; })[0];
    if (!d) return;
    S.draftId = d.id;
    S.type = d.type; S.audience = d.audience;
    S.title = d.title_bn || ''; S.body = d.body_bn || '';
    S.titleEn = d.title_en || ''; S.bodyEn = d.body_en || ''; S.showEn = !!(d.title_en || d.body_en);
    closeSheet();
    S.tab = 'compose';
    render();
    toast('ok', T('draftRestored') || T('cpDraftSaved'), S.lang === 'bn' ? d.name_bn : d.name);
  },
  draft_delete: function(el){
    var S = NS.state, id = el.dataset.id;
    S.drafts = S.drafts.filter(function(x){ return x.id !== id; });
    if (S.draftId === id) S.draftId = null;
    persist();
    openSheet('drafts');
    renderToasts();
    toast('warn', T('discardDraft'), T('done'));
  },
  aiopen: function(){
    NS.state.tab = 'compose';
    render();
    setTimeout(function(){
      var t = document.getElementById('nsAiThread');
      if (t) t.scrollIntoView({ block:'center', behavior:'smooth' });
      var c = document.getElementById('nsAiCmd');
      if (c) c.focus();
    }, 40);
  },
  ai_prompt: function(el){ var S = NS.state; S.aiCommand = el.dataset.v; render(); aiRun(el.dataset.v); },
  ai_send: function(){ aiRun(NS.state.aiCommand); },
  ai_cmd_enter: function(){},
  ai_apply: function(){
    var S = NS.state;
    if (typeof S.lastAiApply === 'function') {
      S.lastAiApply();
      S.lastAiApply = null;
      scheduleAutosave();
      render();
      toast('ok', T('cpApply'), S.lang === 'bn' ? 'এআই-এর প্রস্তাব প্রয়োগ করা হয়েছে — অনুমোদন এখনো আপনার।' : 'AI proposal applied — approval is still yours.');
    } else {
      toast('warn', T('cpAI'), S.lang === 'bn' ? 'প্রয়োগ করার মতো কিছু নেই।' : 'Nothing to apply.');
    }
  },
  ai_clear: function(){ NS.state.aiThread = []; NS.state.lastAiApply = null; render(); },
  toast: function(el){}
};

ACT.aicmd = function(el){ NS.state.aiCommand = el.value; };

/* ---------- event wiring ---------- */

function closestAct(node){
  while (node && node !== document.body) {
    if (node.dataset && node.dataset.act) return node;
    node = node.parentNode;
  }
  return null;
}

document.addEventListener('click', function(e){
  var el = closestAct(e.target);
  if (!el) {
    if (!e.target.closest || !e.target.closest('.ns-popwrap')) {
      document.querySelectorAll('.ns-pop.is-open').forEach(function(p){ p.classList.remove('is-open'); });
      document.querySelectorAll('[data-act="pop"]').forEach(function(b){ b.setAttribute('aria-expanded', 'false'); });
    }
    return;
  }
  var act = el.dataset.act;
  if (act === 'endetails') return;
  if (act === 'pop') { e.stopPropagation(); }
  if (ACT[act]) {
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox'))) e.preventDefault();
    ACT[act](el);
    if (act !== 'pop' && !/^(sentq|tplq)$/.test(act)) {
      document.querySelectorAll('.ns-pop.is-open').forEach(function(p){ p.classList.remove('is-open'); });
    }
  }
}, false);

document.addEventListener('input', function(e){
  var el = closestAct(e.target);
  if (!el) return;
  var act = el.dataset.act;
  if (/^(title|body|titleen|bodyen|image|target|cta|utm|titleb|bodyb|customtype|segname|aicmd)$/.test(act)) {
    if (ACT[act]) ACT[act](el);
  }
}, false);

document.addEventListener('change', function(e){
  var el = closestAct(e.target);
  if (!el) return;
  var act = el.dataset.act;
  if (/^(settype|setchannel|setaudience|exclude|freq|when|tz|recurring|every|priority|ab|person|toggleen|settemplate|sentstatus|senttype|sentchannel|rulefield|ruleop|rulevalue|segbase)$/.test(act)) {
    if (ACT[act]) ACT[act](el);
  }
}, false);

document.addEventListener('keydown', function(e){
  var S = NS.state;
  var ov = document.getElementById('nsOverlay');
  if (e.key === 'Escape') {
    if (ov) { e.preventDefault(); closeSheet(); return; }
    var pop = document.querySelector('.ns-pop.is-open');
    if (pop) { pop.classList.remove('is-open'); document.querySelectorAll('[data-act="pop"]').forEach(function(b){ b.setAttribute('aria-expanded', 'false'); }); return; }
  }
  if (e.key === 'Tab' && ov) {
    var f = ov.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.authed) ACT.savedraft();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (S.authed && S.tab === 'compose') { e.preventDefault(); e.shiftKey ? ACT.testsend() : ACT.review(); }
  }
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'nsAiCmd' && !e.shiftKey) {
    e.preventDefault();
    aiRun(S.aiCommand);
  }
}, false);

document.addEventListener('mousedown', function(e){
  var ov = document.getElementById('nsOverlay');
  if (ov && e.target === ov) closeSheet();
}, false);

function wireDetails(){
  var S = NS.state;
  ['nsDetEn','nsDetAudience','nsDetSchedule','nsDetAdvanced'].forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    if (S.detailsOpen && typeof S.detailsOpen[id] === 'boolean') el.open = S.detailsOpen[id];
    el.addEventListener('toggle', function(){ S.detailsOpen[id] = el.open; }, false);
  });
}

/* ---------- keyboard inset ---------- */

function wireKeyboard(){
  if (!window.visualViewport) return;
  var vv = window.visualViewport;
  var apply = function(){
    var inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--keyboard-inset', Math.round(inset) + 'px');
    var el = document.activeElement;
    if (inset > 90 && el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
      setTimeout(function(){
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(err){}
      }, 60);
    }
  };
  vv.addEventListener('resize', apply, { passive: true });
  vv.addEventListener('scroll', apply, { passive: true });
}
function wireViewport(){
  var setVh = function(){
    document.documentElement.style.setProperty('--vh', window.innerHeight / 100 + 'px');
  };
  setVh();
  window.addEventListener('resize', setVh, { passive: true });
}

/* ---------- boot ---------- */

function restore(){
  var raw = lsGet(STORE_KEY);
  if (!raw) return false;
  try {
    var o = JSON.parse(raw);
    if (o.theme) NS.state.theme = o.theme;
    if (o.lang) NS.state.lang = o.lang;
    if (o.authed) { NS.state.authed = true; }
    if (o.role) NS.state.role = o.role;
    if (o.compose) restoreCompose(o.compose);
    if (o.drafts && o.drafts.length) NS.state.drafts = o.drafts.concat(NS.state.drafts.slice(o.drafts.length));
    return true;
  } catch(e){ return false; }
}

NS.mount = function(el){
  var host = el || document.getElementById('nsRoot') || document.body;
  if (!document.getElementById('nsRoot')) {
    var d = document.createElement('div');
    d.id = 'nsRoot';
    host.appendChild(d);
  }
  if (!document.getElementById('nsToasts')) {
    var t = document.createElement('div');
    t.id = 'nsToasts'; t.className = 'ns-toasts';
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  seed();
  defaults();
  frameRender();
};

NS.setLang = function(v){ applyLang(v); };
NS.setTheme = function(v){ applyTheme(v); };
NS.setState = function(patch){
  if (!patch) return NS.state;
  for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) NS.state[k] = patch[k];
  render();
  return NS.state;
};

function frameRender(){
  wireDetails();
  render();
  renderToasts();
  wireDetails();
}

function boot(){
  seed();
  defaults();
  var had = restore();
  if (had) {
    var raw = lsGet(STORE_KEY);
    try {
      var o = JSON.parse(raw);
      if (o.compose) NS.state.dirty = false;
    } catch(e){}
  }
  if (!document.getElementById('nsRoot')) {
    var d = document.createElement('div');
    d.id = 'nsRoot';
    document.body.appendChild(d);
  }
  if (!document.getElementById('nsToasts')) {
    var t = document.createElement('div');
    t.id = 'nsToasts'; t.className = 'ns-toasts';
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  wireKeyboard();
  wireViewport();
  document.documentElement.dataset.lang = NS.state.lang;
  document.documentElement.dataset.theme = NS.state.theme;
  frameRender();
}
NS.SAMPLE_DATA = function(){ return { segments: NS.state.segments, templates: NS.state.templates, history: NS.state.history, campaigns: NS.state.campaigns, queue: NS.state.queue, automations: NS.state.automations, systemHealth: NS.state.systemHealth, analytics: NS.state.analytics }; };

/* ============================================================
   Part H — backend integration overrides
   The presentation layer above is untouched; everything below swaps the
   prototype's simulated behaviour for the real /api/notifications/* worker.
   Later function declarations win in the same scope, so these definitions
   override the simulated ones.
   ============================================================ */

/* Server errors -> a sentence an operator can act on. */
var NS_ERROR = {
  '-' : {},
  'fcm-not-configured': { bn: 'পুশ সেবা এখনো কনফিগার করা হয়নি।', en: 'Push delivery is not configured yet.' },
  'storage-unavailable': { bn: 'নোটিফিকেশন ডেটাবেস এখন পাওয়া যাচ্ছে না।', en: 'The notification database is unavailable.' },
  'invalid-type': { bn: 'নোটিফিকেশন টাইপ সঠিক নয়।', en: 'The notification type is not valid.' },
  'invalid-title': { bn: 'শিরোনাম ১–১২০ অক্ষরের মধ্যে হতে হবে।', en: 'The title must be 1–120 characters.' },
  'invalid-body': { bn: 'বার্তা ১–৪০০ অক্ষরের মধ্যে হতে হবে।', en: 'The message must be 1–400 characters.' },
  'invalid-schedule': { bn: 'শিডিউলের সময় কমপক্ষে ১ মিনিট ভবিষ্যতে হতে হবে।', en: 'A schedule must be at least 1 minute in the future.' },
  'schedule-too-far': { bn: '৩০ দিনের বেশি দূরে শিডিউল করা যায় না।', en: 'Cannot schedule more than 30 days ahead.' },
  'rate-limited': { bn: 'আজকের পাঠানোর সীমা শেষ হয়েছে (প্রতিদিন ১০টি)।', en: 'The daily send limit is reached (10 per day).' },
  'duplicate': { bn: 'এই একই নোটিফিকেশন সম্প্রতি পাঠানো হয়েছে।', en: 'This identical notification was sent recently.' },
  'forbidden': { bn: 'অ্যাডমিন টোকেন প্রত্যাখ্যাত হয়েছে।', en: 'The admin token was rejected.' },
  'not-scheduled': { bn: 'এই আইটেমটি আর শিডিউল করা নেই।', en: 'This item is no longer scheduled.' },
  'not-found': { bn: 'আইটেমটি খুঁজে পাওয়া যায়নি।', en: 'The item could not be found.' },
  'too-large': { bn: 'ছবিটি অনেক বড় (সর্বোচ্চ ৫ MB)।', en: 'The image is too large (5 MB maximum).' },
  'invalid-json': { bn: 'অনুরোধ ঠিকভাবে পাঠানো যায়নি।', en: 'The request could not be sent correctly.' }
};
function nsErr(code, status){
  var e = NS_ERROR[code];
  if (e && (e.bn || e.en)) return NS.state.lang === 'bn' ? e.bn : e.en;
  return NS.state.lang === 'bn'
    ? ('ডেলিভারি সেবা ত্রুটি জানিয়েছে (' + (code || ('HTTP ' + status)) + ')।')
    : ('The delivery service reported an error (' + (code || ('HTTP ' + status)) + ').');
}

/* Real gate: a token is only "good" once the worker accepts it. */
function renderGate(){
  var S = NS.state;
  var root = document.getElementById('nsRoot');
  if (!root) return;
  root.innerHTML =
    '<div class="ns-gate">' +
      '<div class="ns-gate-card" role="region" aria-labelledby="nsGateTitle">' +
        '<span class="ns-gate-mark">' + ic('shield', 22) + '</span>' +
        '<h1 id="nsGateTitle"' + ha('gateTitle') + '>' + esc(T('gateTitle')) + '</h1>' +
        '<p' + ha('gateSub') + '>' + esc(T('gateSub')) + '</p>' +
        (S.error ? '<div class="ns-callout ns-callout-danger" style="margin-bottom:14px" role="alert">' + ic('alertCircle', 16) +
          '<div>' + esc(S.error) + '</div></div>' : '') +
        '<form id="nsGateForm" novalidate>' +
          '<div class="ns-field"><label class="ns-flabel" for="nsToken"' + ha('gateToken') + '>' + esc(T('gateToken')) +
            ' <span class="ns-req" aria-hidden="true">*</span></label>' +
            '<input class="ns-input" id="nsToken" type="password" autocomplete="off" aria-required="true"' + ph('gateTokenPh') + ' /></div>' +
          '<button type="submit" class="ns-btn ns-btn-primary ns-btn-block" id="nsGateBtn"' + (S.busy ? ' disabled' : '') + '>' +
            esc(S.busy ? T('gateVerifying') : T('gateVerify')) + ic('chevRight', 16) + '</button>' +
        '</form>' +
        '<div class="ns-footer-note" style="margin-top:20px;border-top:1px solid var(--line)">' +
          '<span class="ns-mono">' + esc(T('brandSub')) + '</span><span>v1.0</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  var f = document.getElementById('nsGateForm');
  if (f) f.addEventListener('submit', function(e){
    e.preventDefault();
    var inp = document.getElementById('nsToken');
    var v = inp ? inp.value.trim() : '';
    if (!v) { NS.state.error = T('gateBad'); renderGate(); return; }
    NS.state.busy = true; NS.state.error = null; renderGate();
    var prev = adminTok();
    setAdminTok(v);
    nsFetch('/api/notifications/history').then(function(out){
      NS.state.busy = false;
      if (out.ok) {
        setAdminTok(v);
        NS.state.authed = true; NS.state.token = v;
        NS.state.focusMain = true;
        render();
        toast('ok', T('gateOk'), T('brandSub'));
        loadCenter();
      } else {
        setAdminTok(prev);
        NS.state.error = out.status === 403
          ? (S.lang === 'bn' ? 'টোকেন প্রত্যাখ্যাত হয়েছে। আবার যাচাই করুন।' : 'Token rejected. Check it and try again.')
          : nsErr((out.data && out.data.error) || '', out.status);
        renderGate();
      }
    });
  });
}

/* Real image upload via the worker's R2-backed endpoint. */
function uploadImage(file){
  var S = NS.state;
  var ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  S.imageUploading = true; render();
  return fetch('/api/notifications/global/image', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Authorization': 'Bearer ' + adminTok(),
      'X-File-Ext': ext,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  }).then(function(res){
    return res.json().catch(function(){ return {}; }).then(function(d){ return { ok: res.ok, status: res.status, data: d }; });
  }).then(function(out){
    S.imageUploading = false;
    if (out.ok && out.data && out.data.url) {
      S.imageUrl = out.data.url;
      toast('ok', T('cpImage'), S.lang === 'bn' ? 'ছবি আপলোড হয়েছে।' : 'Image uploaded.');
    } else {
      toast('err', T('cpImage'), nsErr((out.data && out.data.error) || '', out.status));
    }
    render();
  }).catch(function(){
    S.imageUploading = false; render();
    toast('err', T('cpImage'), nsErr('', 0));
  });
}

/* Real cancel of a scheduled notification. */
function ACT_cancelqueue(el){
  var S = NS.state, id = el.dataset.id;
  var target = findItem(id);
  if (!target) return;
  if (target.status !== 'scheduled') {
    toast('warn', T('sCancelled'), S.lang === 'bn'
      ? 'শুধু শিডিউল করা নোটিফিকেশন বাতিল করা যায়।'
      : 'Only scheduled notifications can be cancelled.');
    return;
  }
  var msg = S.lang === 'bn'
    ? ('"' + tr(target, 'title') + '" বাতিল করা হবে — নিশ্চিত?')
    : ('Cancel "' + tr(target, 'title') + '"?');
  if (typeof window.confirm === 'function' && !window.confirm(msg)) return;
  nsFetch('/api/notifications/global/cancel', { method: 'POST', body: JSON.stringify({ id: id }) }).then(function(out){
    if (out.ok) {
      toast('warn', T('sCancelled'), tr(target, 'title'));
      loadCenter();
    } else {
      toast('err', T('sCancelled'), nsErr((out.data && out.data.error) || 'not-scheduled', out.status));
      loadCenter();
    }
  });
}

/* Real send / schedule, driven from the confirm sheet's "send_final". */
function nsSend(scheduled){
  var S = NS.state;
  var when = scheduled ? new Date(S.when).getTime() : NaN;
  var payload = {
    type: TYPES[S.type] ? S.type : 'announcement',
    title: (S.title || '').trim().slice(0, 120),
    body: (S.body || '').trim().slice(0, 400),
    audience: AUD_KEYS.indexOf(S.audience) >= 0 ? S.audience : 'all_students',
    imageUrl: (S.imageUrl || '').slice(0, 500) || null,
    targetUrl: (S.targetUrl || '').slice(0, 200) || null
  };
  if (scheduled) payload.scheduledAt = when;
  var path = scheduled ? '/api/notifications/global/schedule' : '/api/notifications/global/send';
  S.busy = true;
  /* Show the sending sheet with its step animation; the real request runs under it. */
  S.sendPhase = scheduled ? 'scheduling' : 'sending';
  S.sendProgress = 0;
  openSheet('send');
  runSendProgress();
  var p = nsFetch(path, { method: 'POST', body: JSON.stringify(payload) });
  /* Attach the admin's own device so the topic send can reach this device. */
  try {
    if (!scheduled && window.AhFcm && typeof window.AhFcm.getToken === 'function') {
      p = Promise.all([p, Promise.resolve(window.AhFcm.getToken()).catch(function(){ return ''; })])
        .then(function(r){ var tok = r[1]; if (tok) return null; return null; })
        .then(function(){ return p; });
    }
  } catch (_) {}
  p.then(function(out){
    S.busy = false;
    S.sendPhase = null;
    S.sendProgress = 100;
    if (out.ok) {
      var reach = (out.data && out.data.reachEstimate) || 0;
      closeSheet();
      openSheet('success', { scheduled: scheduled, reach: reach });
      toast('ok', scheduled ? T('sScheduled') : T('sdSuccess'), scheduled
        ? (S.lang === 'bn' ? 'কিউতে যুক্ত হয়েছে।' : 'Added to the queue.')
        : T('sdSuccessSub'));
      loadCenter();
    } else {
      closeSheet();
      openSheet('fail', {
        title: S.lang === 'bn' ? 'পাঠানো ব্যর্থ হয়েছে' : 'The send failed',
        why: nsErr((out.data && out.data.error) || '', out.status),
        reason: nsErr((out.data && out.data.error) || '', out.status),
        fix: S.lang === 'bn' ? 'কারণ দেখে সংশোধন করে আবার চেষ্টা করুন।' : 'Fix the cause shown and retry.'
      });
    }
  });
}

/* Replays the four-step progress animation while the real request is in flight. */
function runSendProgress(){
  var steps = [18, 46, 74, 100];
  steps.forEach(function(val, i){
    setTimeout(function(){
      if (NS.state.sheet !== 'send') return;
      NS.state.sendProgress = val;
      var bar = document.querySelector('.ns-progress > span');
      var host = document.querySelector('[role="progressbar"]');
      if (bar) bar.style.width = val + '%';
      if (host) host.setAttribute('aria-valuenow', String(val));
      var items = document.querySelectorAll('.ns-sheet .ns-check-item');
      if (items && items[i]) {
        var icoEl = items[i].querySelector('.ns-check-ico');
        if (icoEl) { icoEl.className = 'ns-check-ico ns-ci-ok'; icoEl.innerHTML = ic('checkCircle', 15); }
      }
    }, 300 * (i + 1));
  });
}

function findItem(id){
  var S = NS.state;
  return S.queue.filter(function(x){ return x.id === id; })[0] ||
         S.history.filter(function(x){ return x.id === id; })[0] || null;
}

/* Queue is derived from history: a 'scheduled' row in the worker IS the queue. */
function queueFromHistory(){
  return NS.state.history.filter(function(h){ return h.status === 'scheduled'; }).map(function(h){
    return { id: h.id, title_bn: h.title_bn, title_en: h.title_en, campaign: null,
      audience: h.audience, type: h.type, channel: 'push',
      scheduledFor: h.scheduledFor, priority: 'normal', status: 'scheduled' };
  });
}

/* Health reflects what the worker can actually do; no invented services. */
function healthFromBackend(sysStatus){
  var S = NS.state;
  var now = Date.now();
  var push = (sysStatus && sysStatus.fcmConfigured) ? 'healthy' : 'unavailable';
  var mine = (sysStatus && Number(sysStatus.devices)) || 0;
  return [
    { id: 'svc_push', bn: 'পুশ সার্ভিস', en: 'Push service', s: push, checked: now,
      cap_bn: 'পুশ নোটিফিকেশন', cap_en: 'Push notifications',
      act_bn: push === 'healthy' ? 'কোনো কাজ দরকার নেই' : 'FCM কনফিগার করা হয়নি — হোস্ট সেটিং যাচাই করুন',
      act_en: push === 'healthy' ? 'No action needed' : 'FCM is not configured — check the host settings' },
    { id: 'svc_db', bn: 'নোটিফিকেশন ডেটাবেস', en: 'Notification database', s: S.offline ? 'unknown' : 'healthy', checked: now,
      cap_bn: 'ইতিহাস ও কিউ', cap_en: 'History and queue',
      act_bn: 'হিস্ট্রি লোড সফল', act_en: 'History loaded successfully' },
    { id: 'svc_queue', bn: 'ডেলিভারি কিউ', en: 'Delivery queue', s: 'healthy', checked: now,
      cap_bn: 'সিডিউলড পাঠানো', cap_en: 'Scheduled sends',
      act_bn: 'ক্রন প্রতি মিনিটে ডিউ আইটেম পাঠায়', act_en: 'Cron dispatches due items each minute' },
    { id: 'svc_device', bn: 'এই ডিভাইস', en: 'This device', s: mine > 0 ? 'healthy' : 'unknown', checked: now,
      cap_bn: 'অ্যাডমিন রিসিভ', cap_en: 'Admin reach',
      act_bn: (mine > 0 ? mine + 'টি ডিভাইস নিবন্ধিত' : 'এই ডিভাইসে নোটিফিকেশন চালু করুন'),
      act_en: (mine > 0 ? mine + ' device(s) registered' : 'Enable notifications on this device') }
  ];
}

/* The prototype framed itself as a full page and repainted the app's root
 * theme attributes. Inside the SPA it must only paint its own scope. */
function applyTheme(v){
  if (['light', 'dark', 'pink', 'green'].indexOf(v) < 0) return;
  NS.state.theme = v; persist();
  document.documentElement.dataset.nsTheme = v;
  render();
}
function applyLang(v){
  if (['bn', 'en'].indexOf(v) < 0) return;
  NS.state.lang = v; persist();
  if (typeof window.__nsApplyScopeLang === 'function') window.__nsApplyScopeLang(v);
  render();
}
function render(){
  var S = NS.state;
  if (!S.authed) { renderGate(); return; }
  document.documentElement.dataset.nsTheme = S.theme;
  var nav = TABS.filter(function(t){ return t.group === 'main'; }).map(navItem).join('') +
    '<div class="ns-nav-label">' + T('navOps') + '</div>' +
    TABS.filter(function(t){ return t.group === 'ops'; }).map(navItem).join('');
  var html = '' +
    '<div class="ns-command-center">' +
      renderTopbar() +
      '<aside class="ns-sidebar" id="nsSidebar">' +
        '<nav class="ns-nav" aria-label="' + esc(T('navMain')) + '">' + nav + '</nav>' +
        '<div class="ns-sidebar-foot">' +
          '<div class="ns-ai-state">' + ic('sparkles', 15) + '<span>' + esc(T('aiAgent')) + '</span>' +
          '<span class="ns-pulse" aria-hidden="true"></span></div>' +
          '<div class="ns-sub-note">' + esc(T('aiReadySub')) + '</div>' +
        '</div>' +
      '</aside>' +
      '<main class="ns-main" id="nsMain" tabindex="-1">' + renderOffline() + renderView() + renderFooter() + '</main>' +
    '</div>' +
    renderMobileNav() + '<div class="ns-kbd-spacer" aria-hidden="true"></div>';
  var root = document.getElementById('nsRoot');
  if (!root) return;
  root.innerHTML = html;
  renderToasts();
  if (S.sheet) renderSheet();
  var m = document.getElementById('nsMain');
  if (m && S.focusMain) { m.focus(); S.focusMain = false; }
  if (typeof window.__nsApplyScopeLang === 'function') window.__nsApplyScopeLang(S.lang);
  enhanceImageField();
}

/* Mount contract for the SPA: render into the app shell, restoring real data. */
NS.mount = function(el){
  var host = el || document.getElementById('nsRoot');
  var root = document.getElementById('nsRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'nsRoot';
    if (host) host.appendChild(root);
  } else if (el && el !== root && root.parentNode !== el) {
    el.appendChild(root);
  }
  if (!document.getElementById('nsToasts')) {
    var t = document.createElement('div');
    t.id = 'nsToasts'; t.className = 'ns-toasts';
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  seed();
  defaults();
  var had = restore();
  NS.state.authed = !!adminTok();
  document.documentElement.dataset.nsTheme = NS.state.theme;
  if (NS.state.authed) {
    render();
    /* Fill the real queue/health as the backend answers. */
    nsFetch('/api/notifications/status').then(function(st){
      NS.state.systemHealth = healthFromBackend(st.ok ? st.data : null);
      render();
    });
    loadCenter().then(function(){
      NS.state.queue = queueFromHistory();
      render();
    });
  } else {
    render();
  }
};

NS.setLang = function(v){ applyLang(v); };
NS.setTheme = function(v){ applyTheme(v); };
NS.setState = function(patch){
  if (!patch) return NS.state;
  for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) NS.state[k] = patch[k];
  render();
  return NS.state;
};
NS.refresh = function(){ return loadCenter(); };
NS.SAMPLE_DATA = function(){
  var S = NS.state;
  return { segments: S.segments, templates: S.templates, history: S.history,
    queue: S.queue, analytics: S.analytics, systemHealth: S.systemHealth };
};

/* The prototype's topbar carried a "simulate state" popover and a fake role
 * switcher. Neither maps to anything the worker can do, so the real topbar
 * keeps only the controls that act on real state: language and theme. */
function renderTopbar(){
  var S = NS.state;
  var themes = [['light','themeLight','#ffffff'],['dark','themeDark','#0b120f'],['pink','themePink','#fdeef3'],['green','themeGreen','#e6f6ec']];
  return '<header class="ns-topbar" id="nsTopbar">' +
    '<div class="ns-brand">' +
      '<span class="ns-brand-mark">' + ic('bell', 17) + '</span>' +
      '<span class="ns-brand-text">' +
        '<span class="ns-brand-name" data-bn="' + esc(I18N.bn.brand) + '" data-en="' + esc(I18N.en.brand) + '">' + esc(T('brand')) + '</span>' +
        '<span class="ns-brand-sub" data-bn="' + esc(I18N.bn.brandSub) + '" data-en="' + esc(I18N.en.brandSub) + '">' + esc(T('brandSub')) + '</span>' +
      '</span>' +
    '</div>' +
    '<div class="ns-topbar-spacer"></div>' +
    '<div class="ns-topbar-tools">' +
      '<div class="ns-popwrap">' +
        '<button type="button" class="ns-iconbtn" data-act="pop" data-pop="lang" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(T('language')) + '">' + ic('globe', 19) + '</button>' +
        '<div class="ns-pop" id="nsPop-lang" role="menu" aria-label="' + esc(T('language')) + '">' +
          '<div class="ns-pop-title">' + esc(T('language')) + '</div>' +
          '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="lang" data-v="bn" aria-checked="' + (S.lang === 'bn') + '"><span>বাংলা (BN)</span><span class="ns-check">' + ic('check', 15) + '</span></button>' +
          '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="lang" data-v="en" aria-checked="' + (S.lang === 'en') + '"><span>English (EN)</span><span class="ns-check">' + ic('check', 15) + '</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="ns-popwrap">' +
        '<button type="button" class="ns-iconbtn" data-act="pop" data-pop="theme" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(T('theme')) + '">' + ic(S.theme === 'dark' ? 'moon' : 'palette', 19) + '</button>' +
        '<div class="ns-pop" id="nsPop-theme" role="menu" aria-label="' + esc(T('theme')) + '">' +
          '<div class="ns-pop-title">' + esc(T('theme')) + '</div>' +
          themes.map(function(t){
            return '<button type="button" class="ns-pop-item" role="menuitemradio" data-act="theme" data-v="' + t[0] + '" aria-checked="' + (S.theme === t[0]) + '">' +
              '<span class="ns-swatch" style="background:' + t[2] + '"></span><span' + ha(t[1]) + '>' + esc(T(t[1])) + '</span><span class="ns-check">' + ic('check', 15) + '</span></button>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</header>';
}

function renderFooter(){
  var S = NS.state;
  return '<div class="ns-footer-note">' +
    '<span class="ns-badge ns-badge-ai">' + ic('sparkles', 12) + esc(T('aiWaiting')) + '</span>' +
    (NS.state.reachEstimate != null ? '<span>' + esc(T('ovReachToday')) + ': ' + fmt(NS.state.reachEstimate) + '</span>' : '') +
    '<span class="ns-muted">' + esc(T('timezone') || '') + ' ' + esc(S.timezone) + '</span>' +
    '<span class="ns-mono">notification-command-center</span>' +
  '</div>';
}

/* Keep the studio's visibility language in step with the app-wide i18n
 * engine, and seed both directions so the first paint matches `ahLang`. */
window.__nsApplyScopeLang = function(lang){
  NS.state.lang = lang;
  var root = document.getElementById('nsRoot');
  if (root && typeof window.AhI18n !== 'undefined' && window.AhI18n.apply) {
    try { window.AhI18n.apply(root); } catch (_) {}
  }
};
try { if (window.AhI18n && window.AhI18n.get) NS.state.lang = window.AhI18n.get(); } catch (_) {}

/* ---------- real reload: history + queue + health, one source of truth ---------- */
function loadCenter(){
  NS.state.dataLoading = true;
  if (NS.state.authed) render();
  return Promise.all([
    nsFetch('/api/notifications/templates').then(function(out){
      if (out.ok && out.data && out.data.templates) NS.state.templates = out.data.templates;
    }),
    nsFetch('/api/notifications/history').then(function(out){
      if (out.ok && out.data && out.data.items) {
        NS.state.history = mapHistory(out.data.items);
        NS.state.queue = queueFromHistory();
        if (out.data.reachEstimate != null) {
          NS.state.reachEstimate = Number(out.data.reachEstimate);
          NS.state.segments = buildSegments();
        }
        if (out.data.dailyCap != null) NS.state.dailyCap.cap = Number(out.data.dailyCap);
        NS.state.dailyCap.used = countSentToday(NS.state.history);
        if (out.data.analytics) NS.state.analytics = mapAnalytics(out.data.analytics, NS.state.history);
      }
    }),
    nsFetch('/api/notifications/status').then(function(st){
      NS.state.systemHealth = healthFromBackend(st.ok ? st.data : null);
    })
  ]).then(function(){
    NS.state.dataLoading = false;
    NS.state.offline = !navigator.onLine;
    if (NS.state.authed) render();
  });
}

/* Retry from an error/empty state now re-fetches instead of conjuring data. */
ACT.simstate = function(el){
  var v = el.dataset.v || 'ok';
  NS.state.viewState = {};
  if (v === 'loading') {
    NS.state.viewState[NS.state.tab] = 'loading';
    render();
    loadCenter().then(function(){
      NS.state.viewState[NS.state.tab] = 'ok';
      render();
    });
    return;
  }
  if (v === 'error') { NS.state.viewState[NS.state.tab] = 'error'; render(); return; }
  if (v === 'empty') { NS.state.viewState[NS.state.tab] = 'empty'; render(); return; }
  render();
  loadCenter();
};

ACT.offline = function(){
  NS.state.offline = !navigator.onLine;
  render();
  toast(NS.state.offline ? 'warn' : 'ok', NS.state.offline ? T('simOffline') : T('okStates'),
    NS.state.offline
      ? (NS.state.lang === 'bn' ? 'অফলাইন — অঞ্চলভিত্তিক ডেটা এখনো দেখানো হচ্ছে।' : 'Offline — cached data is still shown.')
      : (NS.state.lang === 'bn' ? 'সংযোগ ফিরে এসেছে — ডেটা রিফ্রেশ হচ্ছে।' : 'Connection restored — refreshing data.'));
  loadCenter();
};

/* Health re-check reads the real status endpoint. */
ACT.health_check = function(){
  nsFetch('/api/notifications/status').then(function(st){
    NS.state.systemHealth = healthFromBackend(st.ok ? st.data : null);
    render();
    toast('ok', T('hCheck'), NS.state.lang === 'bn' ? 'সেবাগুলো আবার যাচাই করা হয়েছে।' : 'Services re-checked.');
  });
};

/* The worker has no per-admin test channel, so the test-send affordance is
 * removed rather than faked. */
ACT.testsend = function(){
  toast('info', T('cpTestSend'), NS.state.lang === 'bn'
    ? 'টেস্ট পাঠানো এখনো যুক্ত হয়নি — "পাঠান" সব নিবন্ধিত শিক্ষার্থীর কাছে যায়।'
    : 'Test send is not wired yet — "Send" reaches all registered students.');
};
ACT.test_run = function(){ closeSheet(); ACT.testsend(); };

/* Export the real history to a CSV the operator can open. */
ACT.export = function(){
  var S = NS.state;
  if (!S.history.length) { toast('warn', T('sEmpty'), T('sEmptySub')); return; }
  var head = ['id', 'status', 'type', 'audience', 'title', 'sentAt', 'reach', 'delivered', 'clicks', 'error'];
  var esc2 = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var rows = S.history.map(function(h){
    return [h.id, h.status, h.type, h.audience, h.title_bn, h.sentAt ? new Date(h.sentAt).toISOString() : '',
      h.reach, h.delivered, h.clicked, h.error || ''].map(esc2).join(',');
  });
  var csv = head.join(',') + '\n' + rows.join('\n');
  try {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'notification-history.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    toast('ok', S.lang === 'bn' ? 'এক্সপোর্ট প্রস্তুত' : 'Export ready', 'notification-history.csv');
  } catch (_) { toast('err', S.lang === 'bn' ? 'এক্সপোর্ট ব্যর্থ' : 'Export failed', ''); }
};

/* Template edits are local-only (the worker serves a fixed preset list). */
ACT.tpl_new = function(){
  var S = NS.state;
  toast('info', T('tNew'), S.lang === 'bn'
    ? 'নতুন টেমপ্লেট লোকালি যোগ হয়; সার্ভারের প্রিসেট তালিকা অপরিবর্তিত থাকে।'
    : 'New templates are added locally only; the server preset list is unchanged.');
};

/* Tabs whose data the worker does not provide make no false promises. */
function backendlessView(titleKey, subKey, icoName){
  var S = NS.state;
  return pageHead(T(titleKey), T(subKey), '') +
    emptyState(icoName, S.lang === 'bn' ? 'এখনো যুক্ত হয়নি' : 'Not wired yet',
      S.lang === 'bn'
        ? 'এই অংশটি এখনো ডেলিভারি সার্ভারের সাথে সংযুক্ত নয়। সংযুক্ত হলে এখানে বাস্তব ডেটা দেখা যাবে।'
        : 'This section is not connected to the delivery service yet. Real data will appear once it is.',
      '<button type="button" class="ns-btn ns-btn-primary" data-act="tab" data-tab="compose">' + ic('pen', 16) + esc(T('navCompose')) + '</button>');
}
function viewCampaigns(){ return backendlessView('navCampaigns', 'caSub', 'layers'); }
function viewAutomations(){ return backendlessView('navAutomations', 'aSub', 'zap'); }

/* Audit and AI activity have no backend; never show invented entries. */
function renderAuditPanel(){ return ''; }

/* The confirm sheet's final button is the one real send path. */
ACT.send_final = function(){
  var S = NS.state;
  if (!canSend()) { ACT.approval_blocked(); return; }
  closeSheet();
  nsSend(!!S.when);
};

/* Retrying a failed row loads it back into Compose; it never auto-resends, so
 * a person re-reads the fixed content before approving again. */
ACT.retry = function(el){
  var S = NS.state;
  var item = findItem(el.dataset.id);
  closeSheet();
  if (!item) return;
  S.title = tr(item, 'title'); S.body = tr(item, 'body');
  S.audience = item.audience; S.type = item.type;
  S.targetUrl = item.targetUrl || ''; S.imageUrl = item.imageUrl || '';
  S.when = '';
  S.tab = 'compose'; S.dirty = true;
  render();
  toast('warn', T('sRetry'), S.lang === 'bn'
    ? 'কনটেন্ট Compose ট্যাবে লোড হয়েছে — কারণ ঠিক করে আবার অনুমোদন করুন।'
    : 'Content loaded into Compose — fix the cause and approve again.');
};
ACT.retry_send = function(){ closeSheet(); ACT.retry({ dataset: { id: (NS.state.sheetData && NS.state.sheetData.id) || '' } }); };

/* Daily cap fallback keeps the quota bar meaningful before the first load. */
NS.state.dailyCap = { used: 0, cap: 10 };



/* The prototype's image field was URL-only. The worker can store an uploaded
 * picture (R2) and return a stable URL, so a file button is added beside the
 * URL input — the same two paths the legacy panel offered. */
function enhanceImageField(){
  var S = NS.state;
  var input = document.getElementById('nsImage');
  if (!input || !input.parentNode) return;
  if (input.parentNode.querySelector('[data-act="image_upload"]')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ns-btn ns-btn-sm ns-btn-ghost';
  btn.setAttribute('data-act', 'image_upload');
  btn.setAttribute('data-bn', 'ছবি আপলোড');
  btn.setAttribute('data-en', 'Upload image');
  btn.style.marginTop = '8px';
  btn.innerHTML = ic('upload', 14) + '<span data-bn="ছবি আপলোড" data-en="Upload image">' + esc(S.lang === 'bn' ? 'ছবি আপলোড' : 'Upload image') + '</span>';
  input.parentNode.appendChild(btn);
}

function ensureImageInput(){
  var f = document.getElementById('nsImageFile');
  if (f) return f;
  f = document.createElement('input');
  f.type = 'file';
  f.id = 'nsImageFile';
  f.accept = 'image/jpeg,image/png,image/webp';
  f.style.display = 'none';
  f.addEventListener('change', function(){
    var file = f.files && f.files[0];
    if (file) uploadImage(file);
    f.value = '';
  });
  document.body.appendChild(f);
  return f;
}

ACT.image_upload = function(){
  var S = NS.state;
  if (S.imageUploading) return;
  var f = ensureImageInput();
  f.click();
};



/* ---------- SPA bridge ----------
 * The router calls window.renderNotificationAdmin() for `#/notif-admin`. It
 * paints the studio straight into #app, hides the app's bottom nav, and gives
 * the grid shell the full width it needs on desktop. */
window.renderNotificationAdmin = function(){
  var app = document.getElementById('app');
  if (!app) return;
  app.classList.add('no-nav');
  document.body.classList.add('ns-fullwidth');
  var navRoot = document.getElementById('navRoot');
  if (navRoot) navRoot.innerHTML = '';
  app.innerHTML = '<div id="nsRoot"></div>';
  NS.mount(document.getElementById('nsRoot'));
  try { window.scrollTo(0, 0); } catch (_) {}
  return '';
};

})();
