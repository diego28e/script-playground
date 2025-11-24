import React from "react";

export default function TermsPage() {
    return (
        <div className="container mx-auto max-w-4xl py-12 px-4 sm:px-6 lg:px-8">
            <div className="space-y-8">
                <div className="border-b border-zinc-200 pb-5 dark:border-zinc-700">
                    <h1 className="text-3xl font-bold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100">
                        Terms of Service
                    </h1>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                        Last updated: {new Date().toLocaleDateString()}
                    </p>
                </div>

                <div className="prose prose-zinc dark:prose-invert max-w-none">
                    <p>
                        Welcome to Script Playground. By accessing or using our website, you
                        agree to be bound by these Terms of Service and our Privacy Policy.
                    </p>

                    <h3>1. Acceptance of Terms</h3>
                    <p>
                        By accessing or using Script Playground, you agree to comply with
                        and be bound by these Terms. If you do not agree to these Terms, you
                        may not access or use the Service.
                    </p>

                    <h3>2. Use of Service</h3>
                    <p>
                        Script Playground provides a platform for coding challenges and
                        practice. You agree to use the Service only for lawful purposes and
                        in accordance with these Terms.
                    </p>
                    <p>
                        You are responsible for all code you execute on the platform. While
                        we strive to provide a safe environment, we are not responsible for
                        any damage caused by the execution of your code or the code of
                        others.
                    </p>

                    <h3>3. User Conduct</h3>
                    <p>You agree not to:</p>
                    <ul>
                        <li>
                            Use the Service in any way that violates any applicable federal,
                            state, local, or international law or regulation.
                        </li>
                        <li>
                            Attempt to gain unauthorized access to, interfere with, damage, or
                            disrupt any parts of the Service, the server on which the Service
                            is stored, or any server, computer, or database connected to the
                            Service.
                        </li>
                        <li>
                            Upload or transmit any code that contains viruses, trojan horses,
                            worms, logic bombs, or other material that is malicious or
                            technologically harmful.
                        </li>
                    </ul>

                    <h3>4. AI Features</h3>
                    <p>
                        Our Service includes AI-powered features (e.g., code explanation,
                        coding assistant). These features use third-party services (Google
                        GenAI). By using these features, you acknowledge that your code
                        snippets and queries may be sent to these third-party providers for
                        processing.
                    </p>

                    <h3>5. Intellectual Property</h3>
                    <p>
                        The Service and its original content (excluding user-generated code),
                        features, and functionality are and will remain the exclusive
                        property of Script Playground and its licensors.
                    </p>

                    <h3>6. Disclaimer of Warranties</h3>
                    <p>
                        The Service is provided on an "AS IS" and "AS AVAILABLE" basis. We
                        make no warranties, expressed or implied, regarding the operation of
                        the Service or the information, content, or materials included
                        therein.
                    </p>

                    <h3>7. Limitation of Liability</h3>
                    <p>
                        In no event shall Script Playground be liable for any indirect,
                        incidental, special, consequential, or punitive damages, including
                        without limitation, loss of profits, data, use, goodwill, or other
                        intangible losses, resulting from your access to or use of or
                        inability to access or use the Service.
                    </p>

                    <h3>8. Changes to Terms</h3>
                    <p>
                        We reserve the right to modify or replace these Terms at any time.
                        If a revision is material, we will try to provide at least 30 days'
                        notice prior to any new terms taking effect.
                    </p>

                    <h3>9. Contact Us</h3>
                    <p>
                        If you have any questions about these Terms, please contact us at
                        support@scriptplayground.com.
                    </p>
                </div>
            </div>
        </div>
    );
}
