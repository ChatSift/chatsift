import type { Metadata } from 'next';
import { Heading } from '@/components/common/Heading';
import { LegalSection } from '@/components/marketing/LegalSection';

export const metadata: Metadata = {
	title: 'Terms of Service',
};

const LAST_UPDATED = 'August 6, 2026';

export default function TermsPage() {
	return (
		<div className="flex flex-col gap-8 pb-12">
			<Heading subtitle={`Effective and last updated: ${LAST_UPDATED}`} title="Terms of Service" />

			<LegalSection title="1. Acceptance & eligibility">
				<p>
					These Terms of Service ("Terms") govern your access to and use of ChatSift's bots, the ChatSift dashboard, and
					any related services (together, the "Service"), operated by ChatSift ("we", "us", "our"). By inviting a
					ChatSift bot to a server, logging into the dashboard, or otherwise using the Service, you agree to these
					Terms.
				</p>
				<p>
					You must be at least 13 years old, or the minimum age required by the laws of your country, to use the Service
					- the same minimum age Discord itself requires. If you don't meet that requirement, don't use the Service.
				</p>
			</LegalSection>

			<LegalSection title="2. The Service">
				<p>
					ChatSift builds Discord bots and a companion dashboard for server moderation and community tooling. The
					Service is provided free of charge, as-is, and may change, or a given feature may be discontinued, at any
					time.
				</p>
			</LegalSection>

			<LegalSection title="3. Your account & access">
				<p>
					The dashboard is accessed via Discord OAuth login - we never ask for or accept your Discord password directly.
					You can manage a server's bot configuration through the dashboard if you hold the relevant permissions in that
					Discord server, or if an existing manager has explicitly granted you dashboard access for that server from its
					settings page.
				</p>
			</LegalSection>

			<LegalSection title="4. Acceptable use">
				<p>You agree not to, and not to help or permit anyone else to:</p>
				<ul>
					<li>
						use the Service to violate any applicable law, or Discord's own Terms of Service or Community Guidelines;
					</li>
					<li>attempt to disrupt, overload, or gain unauthorized access to the Service or its underlying systems;</li>
					<li>use the Service to harass, abuse, or harm another person or community;</li>
					<li>scrape, reverse engineer, or resell access to the Service; or</li>
					<li>misrepresent your identity or affiliation with ChatSift.</li>
				</ul>
			</LegalSection>

			<LegalSection title="5. Content you submit">
				<p>
					AMA questions/answers, ModMail conversations, snippets, and similar content you or your server's members
					submit through the Service ("your content") remain yours. By submitting it, you grant us a license to store,
					process, and display it back to you and your server's staff solely to operate the Service - including, where a
					server's staff choose to answer and publish an AMA question, displaying that question and its answer on a
					public page that doesn't require a Discord account or server membership to view. We don't claim ownership of
					your content, and we don't use it for anything beyond operating the Service.
				</p>
				<p>
					A server's staff, not ChatSift, decide whether and how a question you submit through that server's AMA feature
					gets answered and published. If you'd rather a question not be made publicly viewable this way, don't submit
					it through the Service.
				</p>
				<p>
					You're responsible for your content and for making sure you have the right to submit it. We may remove content
					or restrict access to the Service in response to a violation of these Terms.
				</p>
			</LegalSection>

			<LegalSection title="6. Discord's own terms apply too">
				<p>
					Using a Discord bot or the dashboard doesn't replace or override your agreement with Discord - Discord's{' '}
					<a href="https://discord.com/terms">Terms of Service</a>,{' '}
					<a href="https://discord.com/guidelines">Community Guidelines</a>, and{' '}
					<a href="https://support-dev.discord.com/hc/en-us/articles/8563934450327">Developer Policy</a> all still apply
					to you. Nothing in these Terms overrides Discord's own terms.
				</p>
			</LegalSection>

			<LegalSection title="7. Termination">
				<p>
					You can stop using the Service at any time by removing a bot from your server or simply not using the
					dashboard. We may suspend or terminate your access to the Service, or a specific server's access, at our
					discretion - most commonly for a violation of these Terms, abuse of the Service, or at Discord's own request.
				</p>
			</LegalSection>

			<LegalSection title="8. Disclaimers & limitation of liability">
				<p>
					The Service is provided "as is," without warranties of any kind, express or implied. We don't guarantee the
					Service will be uninterrupted, error-free, or available at all times.
				</p>
				<p>
					To the fullest extent permitted by law, ChatSift will not be liable for any indirect, incidental, or
					consequential damages arising from your use of the Service. Nothing here limits liability that can't be
					limited under applicable law.
				</p>
			</LegalSection>

			<LegalSection title="9. Indemnification">
				<p>
					You agree to indemnify and hold ChatSift harmless from any claim arising from your use of the Service, your
					content, or your violation of these Terms.
				</p>
			</LegalSection>

			<LegalSection title="10. Changes to these Terms">
				<p>
					We may update these Terms from time to time. If we make a material change, we'll update the "last updated"
					date above. Continuing to use the Service after a change means you accept the updated Terms.
				</p>
			</LegalSection>

			<LegalSection title="11. Reporting violations & contact">
				<p>
					If you believe someone is violating these Terms, or you have a question about them, reach out to a ChatSift
					Team member on our <a href="/support">support server</a>.
				</p>
			</LegalSection>
		</div>
	);
}
