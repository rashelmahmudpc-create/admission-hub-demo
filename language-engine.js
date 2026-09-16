/* ============================================================
   ADMISSION HUB — Live app-wide language engine (blueprint §17)

   The app has two switch points that must agree: `AhI18n` in index.html
   (markup contract: data-bn / data-en) and the stored `ahLang` key that the AI
   page already reads. Neither reaches text rendered later by a module such as
   account-access.js or profile-ui.js — those build Bengali strings inline, so
   switching to English left the whole account and profile flow in Bengali.

   Rewriting ~200 inline strings across ~50 modules would touch every file and
   still miss the next one added. Instead this engine owns a translation table
   and rewrites Bengali text nodes in place, re-running on every `ah:lang` event
   and on DOM insertion. Modules keep writing Bengali (the honest default);
   the engine translates whatever appears.

   Scope and safety:
   • Only text nodes and the placeholder / aria-label / title attributes —
     never attribute values, never input values, never code.
   • Unknown strings are left untouched rather than machine-guessed, so a
     missing entry degrades to Bengali instead of showing wrong English.
   • Bengali numerals convert alongside the text so counts stay consistent.
   • The original Bengali is kept per node, so switching back is exact.
   ============================================================ */
(function () {
  'use strict';
  if (window.__ahLanguageEngine) return;
  window.__ahLanguageEngine = true;

  const KEY = 'ahLang';

  /* Bengali → English table. Keys are the exact rendered strings. */
  const DICT = {
    'অ্যাকাউন্ট': 'Account',
    'তোমার Admission Journey': 'Your admission journey',
    'নিরাপদ ও সহজেই account-এ প্রবেশ করো।': 'Sign in safely and easily.',
    'নিরাপদ ও সহজে account-এ প্রবেশ করো।': 'Sign in safely and easily.',
    'ভাষা বেছে নাও': 'Choose language',
    'বাংলা': 'বাংলা',
    'আপনার লক্ষ্য, আপনার অধিকার': 'Your goal, your right',
    'আপনার লক্ষ্যের পথে,': 'On the way to your goal,',
    'প্রথম ধাপটা আজ থেকেই।': 'take the first step today.',
    'শেখা থেকে অর্জন': 'From learning to achieving',
    'এক ধাপ করে সামনে': 'One step at a time',
    'পরিষ্কার ধারণা': 'Clear concepts',
    'নিজেকে যাচাই': 'Test yourself',
    'লক্ষ্যের দিকে': 'Towards your goal',
    'আজ থেকেই শুরু': 'Start today',
    'আবার দেখা হলো': 'Welcome back',
    'তোমার preparation যেখানে থেমেছিল, সেখান থেকেই শুরু করো।': 'Pick up your preparation where you left it.',
    'Log In করতে সমস্যা?': 'Trouble logging in?',
    'Password মনে না থাকলে Forgot password চাপো।': 'Tap Forgot password if you cannot recall it.',
    'নতুন হলে নিচে Sign Up করো।': 'New here? Sign up below.',
    'Passkey থাকলে এক ট্যাপে ঢুকতে পারো।': 'If you have a passkey, one tap gets you in.',
    'Password নতুন করে সেট করো': 'Set a new password',
    'Account-এর email লিখলে reset link পাঠানোর চেষ্টা করা হবে।': 'Enter your account email and we will try to send a reset link.',
    'Reset link পাঠান': 'Send reset link',
    'Login-এ ফিরুন': 'Back to login',
    'Log In-এ ফিরুন': 'Back to login',
    'তোমার বিদ্যালয়ের নাম লিখো': 'Type your school name',
    'নাম লিখতে শুরু করো—আমরা কাছাকাছি school খুঁজে দেব।': 'Start typing a name — we will find nearby matches.',
    'তোমার School কোনটি?': 'Which school is yours?',
    'সর্বোচ্চ ৩টি suggestion দেখাবে; নাম না পেলে নিজের লেখা ব্যবহার করো।': 'Up to 3 suggestions appear; if yours is missing, use your own wording.',
    'নাম খুঁজে পাচ্ছ না?': 'Cannot find the name?',
    'নিচে নাম না পেলে নিজের লেখা দিয়েই এগোতে পারবে।': 'If the name is not listed below, you can continue with your own wording.',
    'বিদ্যালয়ের নাম লিখে “নিজের লেখা ব্যবহার করুন” চাপো।': 'Type the school name and tap “Use my own wording”.',
    'পরে profile থেকে যেকোনো সময় বদলাতে পারবে।': 'You can change this from your profile any time.',
    'পরে profile থেকে যেকোনো তথ্য বদলাতে পারবে।': 'You can change any of this from your profile later.',
    'তুমি কোন কলেজ / বিশ্ববিদ্যালয়ে পড়েছ?': 'Which college or university did you attend?',
    'শিক্ষা প্রতিষ্ঠানের নাম লিখলে আমরা খুঁজে দেব।': 'Type the institution name and we will look it up.',
    'তোমার College / University?': 'Your college or university?',
    'এখন পড়ছ না? কলেজ/বিশ্ববিদ্যালয় না দিয়েও এগোতে পারো।': 'Not studying now? You can continue without a college or university.',
    'কলেজ/বিশ্ববিদ্যালয় খুঁজে পাচ্ছ না?': 'Cannot find your college or university?',
    'এখন পড়ছ না? খালি রেখেও Next চাপতে পারো।': 'Not studying now? You can leave it empty and tap Next.',
    'নাম না পেলে নিজের লেখা দিয়েই এগোতে পারবে।': 'If the name is missing, continue with your own wording.',
    'Account নিরাপদ করো': 'Secure your account',
    'Email ও শক্তিশালী Password দিয়ে account তৈরি করো': 'Create your account with an email and a strong password',
    'তোমার Email': 'Your email',
    'Verification method বাছার আগে কোনো message পাঠানো হবে না।': 'No message is sent before you choose a verification method.',
    'কমপক্ষে ৮ অক্ষর': 'At least 8 characters',
    'একটি বড় অক্ষর': 'One uppercase letter',
    'একটি সংখ্যা': 'One number',
    'আগে থেকেই account আছে?': 'Already have an account?',
    'Account তৈরির পরে Email অথবা Telegram—একটি বাস্তব verification method বেছে নেবে। তার আগে কিছু পাঠানো হবে না।': 'After signup you will choose a real verification method — email or Telegram. Nothing is sent before that.',
    'তোমার account তৈরি হয়েছে — প্রোফাইলের তথ্যও সংরক্ষিত।': 'Your account is created — your profile details are saved too.',
    'তোমার প্রোফাইল': 'Your profile',
    'এই তথ্যই তোমার admission profile': 'This is your admission profile',
    'নাম': 'Name',
    'জন্ম তারিখ': 'Date of birth',
    'বিদ্যালয়': 'School',
    'কলেজ / বিশ্ববিদ্যালয়': 'College / university',
    'তথ্য শুধু admission প্রস্তুতিতে ব্যবহার হবে।': 'This information is used only for admission preparation.',
    'পরের ধাপ': 'Next step',
    'একটি verification বাকি': 'One verification left',
    'একটি বাস্তব method দিয়ে verify করলেই account পুরোপুরি সক্রিয় হবে। পছন্দের আগে কোনো message যাবে না।': 'Verifying with a real method fully activates your account. No message goes out before you choose.',
    'নিরাপদ link — Email OTP নয়': 'Secure link — not an email OTP',
    'official bot-এর ৬ সংখ্যার code': 'Six-digit code from the official bot',
    'একটি verification method বেছে নাও': 'Choose a verification method',
    'তোমার account নিরাপদ রাখতে নিচের যেকোনো একটি পদ্ধতি ব্যবহার করো।': 'Use any one of the methods below to keep your account safe.',
    'সহজ ও দ্রুত · Email OTP নয়, নিরাপদ link': 'Simple and fast · a secure link, not an email OTP',
    'দ্রুত ও নিরাপদ · Verification শেষে optional': 'Fast and secure · optional after verification',
    'WhatsApp দিয়ে verify': 'Verify with WhatsApp',
    'এখন verification পাওয়া যাচ্ছে না': 'Verification is unavailable right now',
    'Telegram দিয়ে verify · Official bot-এর real ৬ সংখ্যার code': 'Verify with Telegram · real six-digit code from the official bot',
    'শুধু available method-ই কাজ করবে। Telegram Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে—Email মালিকানা নয়।': 'Only available methods work. Telegram proves control of your Telegram account — not email ownership.',
    'কোনটি বেছে নেবে?': 'Which one will you choose?',
    'Email link সবচেয়ে সহজ — Spam folder-ও দেখো।': 'An email link is simplest — check your spam folder too.',
    'Telegram code শুধু secure box-এ লিখবে।': 'Enter the Telegram code only in the secure box.',
    'Passkey verification-এর পরে যোগ করা যাবে।': 'A passkey can be added after verification.',
    'অন্য কোনো সমস্যা?': 'Any other problem?',
    'Help নাও': 'Get help',
    'আমরা তোমার verification-এর অপেক্ষায় আছি…': 'We are waiting for your verification…',
    'Verification link পাঠানো হয়েছে': 'Verification link sent',
    'তোমার email-এ': 'to your email',
    '। Email app-এ link-এ tap করে এখানে ফিরে আসো।': '. Tap the link in your email app and come back here.',
    'Email link খোলার অপেক্ষায়': 'Waiting for the email link to open',
    '✓ আমি Verify করেছি — Check করুন': '✓ I have verified — check now',
    'Telegram দিয়ে যাচাই': 'Verify with Telegram',
    'অন্য যাচাই পদ্ধতি': 'Another verification method',
    'Verification email আবার পাঠান': 'Resend verification email',
    'Verification আবার পাঠান': 'Resend verification',
    'তোমার Email-এ একটি ছোট্ট কাজ আছে': 'There is a small task in your email',
    'তোমার': 'Your',
    'নিজের সিদ্ধান্তে': 'on your own decision',
    'নিচের button চাপলে একটি verification link পাঠানো হবে। Email-এ গিয়ে link-এ tap করো।': 'Tapping the button below sends a verification link. Open your email and tap it.',
    'এখনো নতুন link পাঠানো হয়নি': 'No new link has been sent yet',
    'Email link নিয়ে টিপস': 'Tips for the email link',
    'Button চাপার পর Inbox, Spam ও Promotions দেখো।': 'After tapping the button, check Inbox, Spam and Promotions.',
    'Link-এ tap করে এখানে ফিরে এসো।': 'Tap the link and come back here.',
    'ফিরে এসে “আমি Verify করেছি” চাপো।': 'Then tap “I have verified”.',
    'Verification link পাঠান →': 'Send verification link →',
    'অন্য পদ্ধতি ব্যবহার করো': 'Use another method',
    'এই no-cost public version-এ সত্যিকারের WhatsApp verification এখনো available নয়। তাই কোনো message পাঠানো বা success দেখানো হবে না।': 'Real WhatsApp verification is not available in this no-cost public version, so no message is sent and no success is shown.',
    'এখন পাওয়া যাচ্ছে না': 'Unavailable right now',
    'Email link বা Telegram ব্যবহার করো': 'Use an email link or Telegram',
    'অন্য method বেছে নাও': 'Choose another method',
    'অন্য method বেছে নিন': 'Choose another method',
    'Telegram দিয়ে verify করো': 'Verify with Telegram',
    'Telegram খুলে verification request সম্পন্ন করো।': 'Open Telegram and complete the verification request.',
    'Telegram ধাপগুলো': 'Telegram steps',
    'Official bot খুলে START চাপো।': 'Open the official bot and tap START.',
    'Bot-এর ৬ সংখ্যার code শুধু secure box-এ লিখবে।': 'Enter the bot’s six-digit code only in the secure box.',
    'এটি Email মালিকানার প্রমাণ নয়।': 'This is not proof of email ownership.',
    'Official bot-এ START চাপলে real ৬ সংখ্যার code পাবে — Email মালিকানা নয়, Telegram account control নিশ্চিত করে।': 'Tapping START in the official bot gives a real six-digit code — it proves Telegram account control, not email ownership.',
    'Official bot খুলে': 'Open the official bot and',
    'চাপো। Bot যে ৬ সংখ্যার code পাঠাবে, সেটি শুধু নিচের secure box-এ লিখবে।': 'tap it. Enter the six-digit code the bot sends only in the secure box below.',
    '১': '1',
    'Official Telegram bot খোলো': 'Open the official Telegram bot',
    '২': '2',
    'START চাপো ও code নাও': 'Tap START and get the code',
    '৩': '3',
    'Admission Hub-এ code লিখো': 'Enter the code in Admission Hub',
    'START চাপার অপেক্ষায়…': 'Waiting for START…',
    'Telegram-এর ৬ সংখ্যার code': 'Telegram six-digit code',
    'Code পাওয়া যায়নি? Official bot-এ START চাপো।': 'No code yet? Tap START in the official bot.',
    'নতুন code নিন': 'Get a new code',
    'Telegram verification শুধু Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে—Email মালিকানা নয়। Code বা Password কখনো অন্য কোনো chat-এ লিখবে না; শুধু secure form ব্যবহার করবে। START বা animation একা success নয়—নিশ্চিত ফল Admission Hub দেখাবে।': 'Telegram verification proves control of your Telegram account — not email ownership. Never type the code or password into another chat; use only the secure form. START or an animation alone is not success — Admission Hub shows the confirmed result.',
    'আগের account-এ Google যুক্ত করো': 'Link Google to your existing account',
    'একই Email-এ account আছে। একবার আগের Email ও Password দিলে Google নতুন account না বানিয়ে সেটিতেই যুক্ত হবে।': 'An account already exists for this email. Enter its email and password once and Google will link to it instead of creating a new account.',
    'Google যুক্ত করে প্রবেশ করুন': 'Sign in by linking Google',
    'বিকল্প verification': 'Alternative verification',
    'তোমার জন্য available নিরাপদ method ব্যবহার হবে।': 'An available secure method will be used for you.',
    'Verification শুরু করুন': 'Start verification',
    'ফিরে যান': 'Go back',
    'নিরাপদ code লিখুন।': 'Enter the secure code.',
    'Telegram খুলুন': 'Open Telegram',
    'START চাপুন এবং পাওয়া ৬ সংখ্যার code নিচে লিখুন। Telegram খোলা সফল যাচাই নয়; এটি Email মালিকানার প্রমাণও নয়।': 'Tap START and enter the six-digit code below. Opening Telegram is not a successful verification and does not prove email ownership.',
    '৬ সংখ্যার code': 'Six-digit code',
    'Security verification দরকার': 'Security verification required',
    'সব device থেকে লগ আউট একটি গুরুত্বপূর্ণ কাজ। নিশ্চিত করতে তোমার verification-এ পাঠানো ৬ সংখ্যার code লিখুন।': 'Logging out of all devices is a significant action. To confirm, enter the six-digit code sent to your verification method.',
    'START চাপুন এবং পাওয়া ৬ সংখ্যার code নিচে লিখুন।': 'Tap START and enter the six-digit code below.',
    'বাতিল করুন': 'Cancel',
    'তোমার Email এবং account নিরাপদভাবে যাচাই হয়েছে।': 'Your email and account have been verified safely.',
    'এক ট্যাপেই নিরাপদে ঢুকবে': 'One tap gets you in safely',
    'Face ID, fingerprint বা device lock ব্যবহার করে account secure করো।': 'Secure your account with Face ID, fingerprint or your device lock.',
    'Passkey কী?': 'What is a passkey?',
    'ফোনের Face ID বা fingerprint-ই তোমার চাবি।': 'Your phone’s Face ID or fingerprint is the key.',
    'Password মনে রাখতে হয় না।': 'You do not have to remember a password.',
    'না চাইলে “পরে করব” চাপো।': 'If you would rather not, tap “Later”.',
    'তোমার device-এর built-in security ব্যবহার করা হবে।': 'Your device’s built-in security will be used.',
    'পরে করব': 'Later',
    'Passkey সম্পূর্ণ optional। Skip করলে Email, Password, Google বা Telegram বন্ধ হবে না। ফোনের নিজের অনুমতি screen-এ শেষ সিদ্ধান্ত তোমার।': 'A passkey is entirely optional. Skipping it does not disable email, password, Google or Telegram. The final decision is yours on your phone’s own permission screen.',
    'সব ঠিক আছে! 🎉': 'All set! 🎉',
    'তোমার account এখন প্রস্তুত।': 'Your account is ready.',
    '… Profile details দেখা হচ্ছে': '… Checking your profile details',
    'Admission Hub-এ প্রবেশ করো →': 'Enter Admission Hub →',
    'Account নিরাপদ ও সক্রিয়': 'Account secure and active',
    'তোমার account সত্যিকারের যাচাইয়ের মাধ্যমে সক্রিয় আছে।': 'Your account is active through real verification.',
    'এই device-এ দ্রুত প্রবেশ চালু করতে পারো।': 'You can enable quick access on this device.',
    'নতুন Passkey যোগ করুন': 'Add a new passkey',
    'এই device-কে trust করবে?': 'Trust this device?',
    'পরবর্তী ৩০ দিন এই device থেকে লগইন করলে extra verification লাগবে না।': 'Signing in from this device for the next 30 days will not need extra verification.',
    'Trust করি (৩০ দিন)': 'Trust it (30 days)',
    'না, ধন্যবাদ': 'No, thanks',
    'বিকল্প যাচাই': 'Alternative verification',
    'সব device থেকে Log Out': 'Log out of all devices',
    'Password ও প্রবেশের গোপন তথ্য এই পেজে দেখানো বা জমা রাখা হয় না।': 'Passwords and sign-in secrets are never shown or stored on this page.',
    'এই মুহূর্তে': 'right now',
    'বিদ্যালয়ের নাম লিখো': 'Type the school name',
    'কলেজ বা বিশ্ববিদ্যালয়ের নাম': 'College or university name',
    'একই Password আবার লিখো': 'Type the same password again',
    'বন্ধ করুন': 'Close',
    'Admission প্রস্তুতির interactive journey map': 'Interactive journey map for admission preparation',
    'Admission Hub সুবিধা': 'Admission Hub benefits',
    'প্রবেশের পদ্ধতি': 'Sign-in methods',
    'Google দিয়ে প্রবেশ এখন প্রস্তুত হচ্ছে': 'Google sign-in is being prepared',
    'Admission Hub AI সহায়ক': 'Admission Hub AI helper',
    'Password দেখুন': 'Show password',
    'Log In নিয়ে সাহায্য': 'Help with logging in',
    'প্রতিষ্ঠানের suggestion': 'Institution suggestions',
    'নাম খোঁজা নিয়ে সাহায্য': 'Help with name search',
    'Verification নিয়ে সাহায্য': 'Help with verification',
    'Email verification নিয়ে সাহায্য': 'Help with email verification',
    'Telegram verification নিয়ে সাহায্য': 'Help with Telegram verification',
    'Passkey নিয়ে সাহায্য': 'Help with passkeys',

    /* ---- Profile UI ---- */
    'Profile সম্পূর্ণ করুন': 'Complete your profile',
    'প্রথম practice শেষ করলে stats এখানে জীবন্ত হয়ে উঠবে।': 'Finish your first practice and these stats come alive.',
    'Real milestones only — কিছু না করলে fake step দেখাবে না।': 'Real milestones only — nothing is shown as done if you have not done it.',
    'প্রথম achievement-এর জন্য practice শুরু করুন।': 'Start practising to earn your first achievement.',
    'Real data থেকে unlock হয় — কোনো fake progress নেই।': 'Unlocked from real data — there is no fake progress.',
    'Real study data থেকে unlock হয় — কোনো fake progress নেই।': 'Unlocked from real study data — there is no fake progress.',
    'সব milestone real data থেকে আসে — skip/fake করা যায় না।': 'Every milestone comes from real data — none can be skipped or faked.',
    'Explicit settings — তুমি কী চাও সেটা তুমিই ঠিক করো।': 'Explicit settings — you decide what you want.',
    'লিংক কপি': 'Copy link',
    'Email, mobile, জন্মের তারিখ আর school-এর বিস্তারিত কখনো public হবে না।': 'Email, mobile, date of birth and school details are never made public.',
    'Email, mobile, জন্মের তারিখ আর school-এর বিস্তারিত কখনো public হবে না — কোনো visibility-তেই নয়।': 'Email, mobile, date of birth and school details are never made public — under any visibility setting.',
    'Private — এখনো কিছুই public নয়।': 'Private — nothing is public yet.',
    'এই অংশটা দেখা যাচ্ছে না — বাকি সব ঠিক আছে।': 'This part is not showing — everything else is fine.',
    'স্কুল / কলেজ': 'School / college',
    'উচ্চ শিক্ষা প্রতিষ্ঠান': 'Higher education institution',
    '(optional, সর্বোচ্চ ২৮০)': '(optional, up to 280)',
    'অপরিবর্তিত কিছু নেই — পরিবর্তন করলে Save হবে': 'Nothing changed yet — edits save when you tap Save',
    'ছবি সর্বোচ্চ 5MB · JPG, PNG · ক্রপ করে 1:1 করা হবে': 'Image up to 5MB · JPG, PNG · cropped to 1:1',
    'ছেলে / মেয়ে — যেটা তোমার সাথে মেলে': 'Male / female — whichever matches you',
    'Unit ও subject নির্ভর করে নির্বাচিত university + session-এর official catalog-এর ওপর।': 'Units and subjects come from the official catalog of the university and session you select.',
    'সর্বোচ্চ 5টা target রাখা যায়।': 'You can keep up to 5 targets.',
    'Target-এ university + unit নির্বাচন করলে ওই unit-এর official subject-গুলো এখানে দেখাবে।': 'Pick a university and unit in your target and that unit’s official subjects appear here.',
    '(১ম = first choice)': '(1st = first choice)',
    'এখনো কোনো target নেই — নিচে যোগ করো।': 'No target yet — add one below.',
    'তোমার goal': 'Your goal',
    '(সর্বোচ্চ ১৬০)': '(up to 160)',
    '(সর্বোচ্চ ৮)': '(up to 8)',
    'অন্য subject থাকলে নিচে add করো।': 'If you have another subject, add it below.',
    'সর্বোচ্চ 8টা subject রাখা যায়।': 'You can keep up to 8 subjects.',
    'বন্ধ করো': 'Close',
    'বাতিল': 'Cancel',
    'এই পছন্দ শুধু তোমার AI চ্যাটে প্রয়োগ হয় — অন্য user-এর সাথে কখনো share হয় না।': 'This preference applies only to your AI chat — it is never shared with another user.',
    'AI তোমার আগের কথা মনে রাখবে (device+account-এ save হয়)': 'The AI remembers your earlier conversation (saved to this device and account)',
    'ছবি ঠিক করো': 'Adjust photo',
    'ছবি ধরে টানুন · দুই আঙুলে বা +/− দিয়ে বড়-ছোট করুন': 'Drag the photo · pinch or use +/− to zoom',
    'Sign in to create your profile — এক identity, সব device-এ।': 'Sign in to create your profile — one identity across all your devices.',
    'Login যাচাই হচ্ছে…': 'Checking your login…',
    'Profile লোড করা যায়নি — নিশ্চিন্ত থাকো, তোমার session আর ডেটা ঠিক আছে।': 'Your profile could not load — rest assured your session and data are fine.',
    'Profile লোড করা যায়নি': 'Your profile could not load',
    'আবার চেষ্টা করো': 'Try again',
    'একটু পরে আবার চেষ্টা করো।': 'Try again in a moment.',
    'Profile খুঁজে পাওয়া যায়নি': 'Profile not found',
    'এই public profile এখন available নাই': 'This public profile is not available right now',
    'মালিক private সেট করেছে বা profile খুঁজে পাওয়া যায়নি।': 'The owner set it to private, or the profile was not found.',
    'আপনি Admission Hub-এ? Profile দেখো': 'Are you on Admission Hub? View your profile',
    'Avatar পরিবর্তন করো': 'Change avatar',
    'Study stats — Exam পেজে যাও': 'Study stats — go to the Exam page',
    'ফিরে যাও': 'Go back',
    'তোমার পুরো নাম': 'Your full name',
    'যেমন: নটর ডেম কলেজ': 'e.g. Notre Dame College',
    'জেলা (optional)': 'District (optional)',
    'যেমন: ঢাকা বিশ্ববিদ্যালয়': 'e.g. University of Dhaka',
    'নিজের সম্পর্কে এক লাইন…': 'One line about yourself…',
    'Photo সরাও': 'Remove photo',
    'মুছে ফেলো': 'Delete',
    'উপরে': 'Up',
    'নিচে': 'Down',
    'ইউনিভার্সিটি লিখো… (যেমন: CU, ঢাকা, BUET)': 'Type a university… (e.g. CU, Dhaka, BUET)',
    'যেমন: 2026-এ CU CSE-তে ভর্তি হবো': 'e.g. I will apply to CU CSE in 2026',
    'অন্য subject (manual)': 'Another subject (manual)',
    'ছোট করো': 'Zoom out',
    'বড় করো': 'Zoom in',
    'Public profile লোড হচ্ছে': 'Loading public profile'
  };

  /* Bengali digits, so numbers inside a translated string stay consistent. */
  const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  const toEnDigits = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

  const get = () => {
    try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'bn'; } catch (_) { return 'bn'; }
  };

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT']);

  /* Bengali composes many letters two ways in Unicode: য় is either U+09DF or
     য + ় (U+09AF U+09BC), and the two are visually identical. Source files and
     this table can each pick a different form, so both sides are normalised
     before lookup — otherwise a string silently fails to translate. */
  const norm = (s) => (typeof s === 'string' && s.normalize ? s.normalize('NFC') : s);
  const NORM_DICT = {};
  for (const [k, v] of Object.entries(DICT)) NORM_DICT[norm(k)] = v;

  /* A node's Bengali source is remembered on first sight so switching back to
     Bengali restores the exact original text and attributes. */
  const original = new WeakMap();

  const translate = (text) => {
    const direct = NORM_DICT[norm(text)];
    if (direct) return direct;
    const trimmed = text.trim();
    if (!trimmed) return text;
    const hit = NORM_DICT[norm(trimmed)];
    if (hit) return text.replace(trimmed, toEnDigits(hit));
    return null;
  };

  const walk = (root, lang) => {
    if (!root) return;
    const nodes = [];
    const push = (n) => nodes.push(n);
    if (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) {
      const iter = document.createTreeWalker(root, 1 | 4, null);
      let n = iter.nextNode();
      while (n) { push(n); n = iter.nextNode(); }
      push(root);
    }
    for (const el of nodes) {
      if (el.nodeType === 4) continue;
      if (el.nodeType === 3) {
        if (el.parentElement && SKIP_TAGS.has(el.parentElement.tagName)) continue;
        if (!original.has(el)) original.set(el, el.nodeValue);
        const src = original.get(el);
        if (lang === 'en') {
          const out = translate(src);
          if (out != null && el.nodeValue !== out) el.nodeValue = out;
        } else if (el.nodeValue !== src) {
          el.nodeValue = src;
        }
        continue;
      }
      if (el.nodeType !== 1) continue;
      // An INPUT/TEXTAREA has no translatable text child, but its own
      // placeholder still is copy — so only the text walk is skipped.
      for (const attr of ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        const key = `ah-orig-${attr}`;
        if (!el.hasAttribute(key)) el.setAttribute(key, el.getAttribute(attr));
        const src = el.getAttribute(key);
        if (lang === 'en') {
          const out = translate(src);
          if (out != null) el.setAttribute(attr, out);
        } else {
          el.setAttribute(attr, src);
        }
      }
    }
  };

  const apply = (root) => {
    const lang = get();
    try { document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'bn'); } catch (_) {}
    walk(root || document.body, lang);
  };

  /* Late-rendered markup (a view swap, a toast, a sheet) is translated as it
     appears, which is what makes this work without touching those modules. */
  const observe = () => {
    if (typeof MutationObserver !== 'function') return;
    let queued = false;
    const pending = new Set();
    new MutationObserver((records) => {
      if (get() !== 'en') return;
      for (const r of records) {
        if (r.type === 'characterData') pending.add(r.target);
        for (const n of r.addedNodes || []) pending.add(n);
      }
      if (queued || !pending.size) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const batch = [...pending];
        pending.clear();
        for (const n of batch) walk(n, 'en');
      });
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };

  window.addEventListener('ah:lang', () => apply());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { apply(); observe(); });
  else { apply(); observe(); }

  window.AhLanguage = { apply, translate, dict: DICT, get };
})();
