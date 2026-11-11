import type { InfoPage } from "./news";

/*
 * Support and legal pages shown at /info/<slug>. Only four reader-facing
 * addresses exist: info@, hello@, support@ and contact@themidnightnews.com.
 */
const UPDATED = "Last updated: 28 October 2026";

const privacy: InfoPage = {
  title: "Privacy policy",
  text: `We collect as little as we can, we never sell your data, and we tell you exactly what we store and why. ${UPDATED}.`,
  sections: [
    {
      heading: "Who we are",
      body: [
        "This policy explains how Midnight Media (“Midnight”, “we”, “us”) handles personal information when you use themidnightnews.com and related services (the “Service”). Midnight is the controller of the personal information described here.",
        "Questions about this policy or your data can be sent to support@themidnightnews.com.",
      ],
    },
    {
      heading: "Information you give us",
      bullets: [
        "Account details — your email address, display name and a password when you create an account. Passwords are stored only in hashed form by our authentication provider; we can never see them.",
        "Community activity — comments, replies, likes and saved stories you choose to make while signed in.",
        "Messages — anything you send us by email, such as a correction, a tip or a support request.",
      ],
    },
    {
      heading: "Information collected automatically",
      bullets: [
        "Reading statistics — the page you visited, the referring site, the type of device (mobile, tablet or desktop) and the time of the visit. Each visit is linked to a random identifier created in your browser, not to your name or email.",
        "Analytics — we use Google Analytics to understand how the Service is used in aggregate. Google processes this information under its own privacy policy.",
        "Security data — a one-way hash of your network address is used to limit abuse such as repeated sign-up attempts and automated attacks.",
      ],
    },
    {
      heading: "Browser storage",
      body: [
        "We do not use advertising or tracking cookies. To work properly, the Service keeps a small amount of information in your browser's local storage: the random reading identifier described above and, if you sign in, your session so you stay signed in. You can clear this at any time from your browser settings; doing so signs you out.",
      ],
    },
    {
      heading: "How we use information",
      bullets: [
        "To provide the Service — running your account, showing your comments and saved stories, and keeping you signed in.",
        "To improve the Service — understanding which stories and features readers use.",
        "To keep the Service safe — preventing spam, fraud, abuse and attacks, and enforcing our Terms.",
        "To communicate with you — replying to your messages and, where necessary, telling you about important changes to the Service or these policies.",
        "To meet legal obligations — where the law requires us to keep or disclose information.",
      ],
    },
    {
      heading: "Legal bases",
      body: [
        "Where data protection law such as the Kenya Data Protection Act 2019, the UK GDPR or the EU GDPR applies, we rely on: performance of a contract (running your account), our legitimate interests (security, analytics and improving the Service, balanced against your rights), legal obligation, and your consent where we ask for it. You may withdraw consent at any time.",
      ],
    },
    {
      heading: "Sharing",
      body: [
        "We never sell or rent your personal information. We share it only with service providers who help us run the Service — hosting, database, authentication and analytics — under contracts that require them to protect it and use it only on our instructions; with authorities when required by law or to protect the safety of any person; and with a successor if Midnight is reorganised or acquired, in which case this policy will continue to apply.",
        "Comments you post publicly are visible to other readers along with your display name.",
      ],
    },
    {
      heading: "Advertising",
      body: [
        "Midnight may show advertising in the future, including through Google Ads. Before any advertising service that uses cookies or similar technologies is switched on, we will update this policy and, where the law requires it, ask for your consent first.",
      ],
    },
    {
      heading: "International transfers",
      body: [
        "Our providers may process information outside your country. Where that happens, we rely on appropriate safeguards such as standard contractual clauses.",
      ],
    },
    {
      heading: "How long we keep information",
      bullets: [
        "Account and community data — for as long as your account is open. When you delete your account, we delete or anonymise it within 30 days, except where we must keep it for legal reasons.",
        "Reading statistics — up to 24 months, then deleted or aggregated.",
        "Security records — up to 12 months.",
        "Emails to us — up to 24 months after the matter is resolved.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "Depending on where you live, you may have the right to access, correct, delete or receive a copy of your personal information, to object to or restrict certain processing, and to withdraw consent. To exercise any of these rights, write to support@themidnightnews.com from the email address on your account. We respond within 30 days.",
        "You also have the right to complain to a data protection authority, such as the Office of the Data Protection Commissioner in Kenya or the Information Commissioner's Office in the UK.",
      ],
    },
    {
      heading: "Security",
      body: [
        "We use encryption in transit, hashed passwords, access controls and monitoring to protect your information. No system is perfectly secure; if a breach affects you, we will tell you and the relevant authorities as the law requires.",
      ],
    },
    {
      heading: "Children",
      body: [
        "The Service is not directed at children under 13, and you must be at least 13 to create an account. If you believe a child has given us personal information, contact us and we will delete it.",
      ],
    },
    {
      heading: "Changes to this policy",
      body: [
        "We may update this policy from time to time. The date at the top shows when it last changed. For significant changes we will give notice on the Service before they take effect.",
      ],
    },
  ],
};

const termsOfUse: InfoPage = {
  title: "Terms of use",
  text: `The rules for reading, commenting and taking part on Midnight. ${UPDATED}.`,
  sections: [
    {
      heading: "Using Midnight",
      body: [
        "Midnight is free to read. You may browse, read and share links to our stories for your personal, non-commercial use. By using the Service you agree to these Terms of use and to our Terms and conditions and Privacy policy.",
      ],
    },
    {
      heading: "Community rules",
      bullets: [
        "Be civil. Debate ideas, not people. No harassment, threats, hate speech or personal attacks.",
        "Stay on topic and do not spam, advertise or post the same message repeatedly.",
        "Do not post anything unlawful, defamatory, obscene, or that infringes someone else's rights.",
        "Do not share anyone's private information, including your own.",
        "Do not impersonate others or misrepresent who you are.",
        "Do not post links to malware, scams or misleading sites.",
      ],
    },
    {
      heading: "Moderation",
      body: [
        "We may remove comments, limit features or suspend accounts that break these rules, with or without notice. Repeated or serious breaches lead to permanent removal. If you think we got a decision wrong, write to support@themidnightnews.com.",
      ],
    },
    {
      heading: "Reporting",
      body: [
        "Use the report option on any comment or story to flag a problem, or write to contact@themidnightnews.com. We review every report.",
      ],
    },
    {
      heading: "Acceptable use",
      bullets: [
        "Do not scrape, copy in bulk, or systematically download our content, including for training artificial intelligence systems, without written permission.",
        "Do not attempt to probe, disrupt, overload or gain unauthorised access to the Service.",
        "Do not use automated means to create accounts, post comments or inflate likes and views.",
      ],
    },
  ],
};

const termsAndConditions: InfoPage = {
  title: "Terms and conditions",
  text: `The agreement between you and Midnight Media when you use our websites and services. Please read it carefully. ${UPDATED}.`,
  sections: [
    {
      heading: "1. Agreement",
      body: [
        "These Terms and conditions (the “Terms”) form a binding agreement between you and Midnight Media (“Midnight”, “we”, “us”) covering your use of themidnightnews.com and related services (the “Service”). By accessing or using the Service, you accept these Terms. If you do not agree, do not use the Service.",
      ],
    },
    {
      heading: "2. Eligibility and accounts",
      body: [
        "You must be at least 13 years old to create an account, and old enough to form a binding contract where you live, or have permission from a parent or guardian. You are responsible for keeping your password secure and for all activity under your account. Tell us immediately at support@themidnightnews.com if you suspect unauthorised use.",
      ],
    },
    {
      heading: "3. Our content",
      body: [
        "All articles, reports, images, graphics, logos and other material on the Service are owned by Midnight or our licensors and protected by copyright and other laws. We grant you a limited, personal, non-exclusive, non-transferable licence to view and share links to our content for non-commercial purposes. You may not reproduce, republish, sell or create derivative works from our content without our written permission. Licensing requests go to info@themidnightnews.com.",
      ],
    },
    {
      heading: "4. Your content",
      body: [
        "You keep ownership of the comments and other material you post (“User Content”). By posting it, you grant Midnight a worldwide, royalty-free, non-exclusive licence to host, display, reproduce and distribute it in connection with the Service. You confirm that you have the right to post your User Content and that it complies with these Terms and our Terms of use. We are not responsible for User Content and may remove it at our discretion.",
      ],
    },
    {
      heading: "5. Advertising",
      body: [
        "The Service may display advertising, including advertising delivered by third parties such as Google. Advertisers have no influence over our editorial content. We are not responsible for the products, services or websites of advertisers.",
      ],
    },
    {
      heading: "6. Accuracy and no professional advice",
      body: [
        "We work hard to make our reporting accurate and correct errors promptly, but content is provided for general information only. Nothing on the Service is financial, legal, medical or other professional advice, and you should not rely on it as such.",
      ],
    },
    {
      heading: "7. Third-party links",
      body: [
        "The Service may link to websites we do not control. We are not responsible for their content, policies or practices.",
      ],
    },
    {
      heading: "8. Copyright complaints",
      body: [
        "If you believe material on the Service infringes your copyright, send a notice to info@themidnightnews.com identifying the work, the material in question and its location, your contact details, and a statement that you are the rights holder or authorised to act for them. We will respond promptly and remove infringing material where appropriate.",
      ],
    },
    {
      heading: "9. Suspension and termination",
      body: [
        "You may stop using the Service and delete your account at any time. We may suspend or terminate your access if you breach these Terms, if required by law, or to protect the Service or other users. Sections that by their nature should survive termination — including ownership, disclaimers, limitation of liability and governing law — will survive.",
      ],
    },
    {
      heading: "10. Disclaimers",
      body: [
        "The Service is provided “as is” and “as available”. To the fullest extent permitted by law, we disclaim all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose and non-infringement. We do not guarantee that the Service will be uninterrupted, secure or error-free.",
      ],
    },
    {
      heading: "11. Limitation of liability",
      body: [
        "To the fullest extent permitted by law, Midnight will not be liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of profits, data or goodwill, arising from your use of the Service. Because the Service is provided free of charge, our total liability for any claim relating to the Service is limited to USD 100. Nothing in these Terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, or for fraud.",
      ],
    },
    {
      heading: "12. Indemnity",
      body: [
        "You agree to indemnify Midnight against claims, losses and costs (including reasonable legal fees) arising from your User Content or your breach of these Terms.",
      ],
    },
    {
      heading: "13. Changes",
      body: [
        "We may change these Terms from time to time. The date at the top shows when they last changed. For significant changes we will give notice on the Service before they take effect. Continuing to use the Service after that date means you accept the updated Terms.",
      ],
    },
    {
      heading: "14. Governing law and disputes",
      body: [
        "These Terms are governed by the laws of Kenya. The courts of Nairobi have jurisdiction over any dispute, except that if you are a consumer living elsewhere you keep the protection of the mandatory laws of your country and may bring proceedings in your local courts. Before starting any formal proceedings, please contact us so we can try to resolve the matter informally.",
      ],
    },
    {
      heading: "15. General",
      body: [
        "If any part of these Terms is found unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not transfer your rights under these Terms; we may transfer ours as part of a reorganisation or sale. These Terms, together with our Terms of use and Privacy policy, are the entire agreement between you and Midnight about the Service.",
      ],
    },
    {
      heading: "Contact",
      body: ["Questions about these Terms: info@themidnightnews.com."],
    },
  ],
};

const accessibility: InfoPage = {
  title: "Accessibility",
  text: "Midnight is built to be readable by everyone, on any device, with any ability. Here is what we do, and how to tell us when something gets in your way.",
  sections: [
    {
      heading: "Our commitment",
      body: [
        "We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA across themidnightnews.com. Accessibility is part of how we design, write and build — not a check at the end.",
      ],
    },
    {
      heading: "What we do",
      bullets: [
        "Clear, plain-language writing, short paragraphs and descriptive headlines.",
        "Text with strong contrast that can be enlarged to 200% without losing content.",
        "Layouts that adapt to phones, tablets and desktops, in portrait and landscape.",
        "Full keyboard navigation with visible focus indicators.",
        "Meaningful headings, landmarks and labels for screen readers.",
        "Respect for your device's reduced-motion setting.",
      ],
    },
    {
      heading: "Known limitations",
      body: [
        "Some older photographs may lack detailed descriptions, and some embedded material from third parties may not fully meet our standards. We are working through these and prioritise anything readers report.",
      ],
    },
    {
      heading: "Feedback and help",
      body: [
        "If you have trouble using any part of Midnight, or need content in a different format, write to support@themidnightnews.com. Tell us the page address and what happened. We reply within two working days and aim to fix reported issues as quickly as possible.",
      ],
    },
  ],
};

export const supportAndLegalPages: Record<string, InfoPage> = {
  subscribe: {
    title: "Subscribe",
    text: "Midnight is free to read. Create a free account to join the conversation and keep the stories that matter to you.",
    sections: [
      {
        heading: "What you get with a free account",
        bullets: [
          "Comment on stories and reply to other readers.",
          "Like stories and save them to read later, on any device.",
          "Your saved stories and activity in one place on your profile.",
        ],
      },
      {
        heading: "How to sign up",
        body: [
          "Select Sign in at the top of any page, choose Create account, and enter your name, email address and a password. That is all — there is nothing to pay.",
          "Prefer not to sign up? Every story and the nightly Midnight Report remain free to read without an account.",
        ],
      },
      {
        heading: "Questions",
        body: ["Write to hello@themidnightnews.com and we will get back to you."],
      },
    ],
  },
  "help-centre": {
    title: "Help centre",
    text: "Answers to the most common questions about your account, reading and taking part on Midnight.",
    sections: [
      {
        heading: "Account",
        bullets: [
          "Creating an account — select Sign in, then Create account. You need an email address and a password of at least 8 characters.",
          "Signing in — use the same email address and password. Sign-in is by email and password only.",
          "Forgotten password — write to support@themidnightnews.com from the email address on your account and we will help you regain access.",
          "Changing your name or details — open your profile from the account button at the top of the page.",
          "Deleting your account — write to support@themidnightnews.com from your account's email address. We delete your data within 30 days.",
        ],
      },
      {
        heading: "Reading",
        bullets: [
          "Is Midnight free? — Yes. All stories and the Midnight Report are free to read.",
          "Finding a story — use the search bar at the top of every page, or browse by section.",
          "The Midnight Report — our nightly edition, available from the Report button at the top of the page.",
        ],
      },
      {
        heading: "Comments, likes and saves",
        bullets: [
          "You need to be signed in to comment, like or save a story.",
          "Your saved stories appear on your profile.",
          "See something that breaks our community rules? Use the report option, or write to contact@themidnightnews.com.",
        ],
      },
      {
        heading: "Still need help?",
        body: ["Write to support@themidnightnews.com. We reply to every message within two working days."],
      },
    ],
  },
  "manage-account": {
    title: "Manage account",
    text: "Update your details, see your saved stories and control your data.",
    sections: [
      {
        heading: "Your profile",
        body: [
          "Sign in and open your profile from the account button at the top of any page. There you can change your display name and see your comments, likes and saved stories.",
        ],
      },
      {
        heading: "Your data",
        bullets: [
          "Ask for a copy of the information we hold about you.",
          "Correct anything that is wrong.",
          "Delete your account and the data linked to it.",
        ],
        body: [
          "For any of these, write to support@themidnightnews.com from the email address on your account. We respond within 30 days, usually much sooner.",
        ],
      },
      {
        heading: "Signing out",
        body: ["Use the account button at the top of the page and choose Sign out. Signing out on one device does not sign you out elsewhere."],
      },
    ],
  },
  "privacy-policy": privacy,
  privacy,
  "terms-of-use": termsOfUse,
  terms: termsAndConditions,
  "terms-and-conditions": termsAndConditions,
  accessibility,
};
