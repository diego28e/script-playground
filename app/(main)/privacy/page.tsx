import React from "react";

export default function PrivacyPage() {
    return (
        <div className="container mx-auto max-w-4xl py-12 px-4 sm:px-6 lg:px-8">
            <div className="space-y-8">
                <div className="border-b border-zinc-200 pb-5 dark:border-zinc-700">
                    <h1 className="text-3xl font-bold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100">
                        Privacy Policy
                    </h1>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                        Last updated: {new Date().toLocaleDateString()}
                    </p>
                </div>

                <div className="prose prose-zinc dark:prose-invert max-w-none">
                    <p>
                        At Script Playground, we respect your privacy and are committed to
                        protecting your personal data. This Privacy Policy explains how we
                        collect, use, and safeguard your information when you use our
                        Service.
                    </p>

                    <h3>1. Information We Collect</h3>
                    <p>
                        We collect only the basic information necessary to provide and
                        improve our Service. This may include:
                    </p>
                    <ul>
                        <li>
                            <strong>Account Information:</strong> If you create an account, we
                            may collect your name, email address, and profile picture (via
                            OAuth providers like Google).
                        </li>
                        <li>
                            <strong>Usage Data:</strong> We may collect information about how
                            you access and use the Service, such as your browser type, device
                            information, and interaction logs.
                        </li>
                        <li>
                            <strong>User Content:</strong> We store the code snippets and
                            challenges you save or submit on the platform.
                        </li>
                    </ul>

                    <h3>2. How We Use Your Information</h3>
                    <p>We use the collected information to:</p>
                    <ul>
                        <li>Provide, maintain, and improve the Service.</li>
                        <li>Authenticate your identity and manage your account.</li>
                        <li>
                            Process your code submissions and provide feedback (including AI
                            analysis).
                        </li>
                        <li>Respond to your comments, questions, and support requests.</li>
                    </ul>

                    <h3>3. AI Features and Third-Party Sharing</h3>
                    <p>
                        Our Service utilizes Artificial Intelligence (AI) features powered
                        by Google GenAI. When you use features like "Explain Code" or "Ask
                        AI":
                    </p>
                    <ul>
                        <li>
                            The code snippets and questions you provide are sent to Google's
                            servers for processing.
                        </li>
                        <li>
                            We do not use your code to train our own AI models, but Google's
                            use of data is governed by their own privacy policy and terms.
                        </li>
                    </ul>
                    <p>
                        We do not sell your personal data to third parties. We only share
                        data with service providers (like database hosts and AI providers)
                        necessary to operate the Service.
                    </p>

                    <h3>4. Data Security</h3>
                    <p>
                        We implement reasonable security measures to protect your information
                        from unauthorized access, alteration, disclosure, or destruction.
                        However, no method of transmission over the Internet or electronic
                        storage is 100% secure.
                    </p>

                    <h3>5. Your Rights</h3>
                    <p>
                        Depending on your location, you may have rights regarding your
                        personal data, such as the right to access, correct, or delete your
                        data. You can manage your account settings within the application or
                        contact us for assistance.
                    </p>

                    <h3>6. Changes to This Policy</h3>
                    <p>
                        We may update this Privacy Policy from time to time. We will notify
                        you of any changes by posting the new Privacy Policy on this page.
                    </p>

                    <h3>7. Contact Us</h3>
                    <p>
                        If you have any questions about this Privacy Policy, please contact
                        us at diego28e@gmail.com.
                    </p>
                </div>
            </div>
        </div>
    );
}
