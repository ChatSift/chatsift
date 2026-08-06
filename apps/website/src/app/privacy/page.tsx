import type { Metadata } from 'next';
import { Heading } from '@/components/common/Heading';
import { LegalSection } from '@/components/marketing/LegalSection';

export const metadata: Metadata = {
	title: 'Privacy Policy',
};

const LAST_UPDATED = 'August 6, 2026';

export default function PrivacyPage() {
	return (
		<div className="flex flex-col gap-8 pb-12">
			<Heading subtitle={`Effective and last updated: ${LAST_UPDATED}`} title="Privacy Policy" />

			<LegalSection title="1. Scope">
				<p>
					This Privacy Policy explains what data ChatSift collects, why, and how you can reach us about it, for our bots
					and the ChatSift dashboard.
				</p>
			</LegalSection>

			<LegalSection title="2. Information we collect">
				<p>We only collect what the Service needs to do the thing you're using it for:</p>
				<ul>
					<li>
						<strong>Discord identifiers.</strong> User IDs, guild (server) IDs, channel/message IDs - the raw
						identifiers Discord itself uses. We don't separately store your username, avatar, or discriminator; those
						are fetched live from Discord whenever the dashboard displays them, not kept in our database.
					</li>
					<li>
						<strong>AMA content.</strong> Questions submitted through an AMA session, tied to the submitting user's ID.
						If a server's staff answer a question and it's sent to the AMA's answers channel, that question and its
						answer can also be viewed on a public, unauthenticated answers page - anyone with the link can see it, no
						Discord account or server membership required. That page shows the question content, the answer content and
						image (if any), and the asker's and answerer's Discord display name and avatar. If staff mark one question
						as a duplicate of another, the duplicate is deleted and its submitter is recorded internally as an
						additional asker of the surviving question, visible only to that server's staff; the public answers page
						shows only the surviving question's original asker.
					</li>
					<li>
						<strong>ModMail content.</strong> Ticket messages are only stored beyond the lifetime of the Discord
						conversation itself if a server's staff explicitly turn on transcript recording for that server - it's
						opt-in per server, off by default. Server config (snippets, greeting messages, category setup) is always
						stored, since it's how the bot is configured.
					</li>
					<li>
						<strong>Dashboard session data.</strong> When you log in via Discord OAuth, we request the{' '}
						<code>identify</code>, <code>guilds</code>, and <code>guilds.members.read</code> scopes - enough to know who
						you are and which servers you can manage - and hold a Discord access/refresh token in an encrypted session
						cookie so you stay logged in. We don't request or store your email address.
					</li>
				</ul>
				<p>We don't collect your IP address, and we don't run any analytics or tracking scripts on the dashboard.</p>
			</LegalSection>

			<LegalSection title="3. How we use it">
				<p>
					Solely to operate the Service: routing AMA questions through the queues you've configured, relaying ModMail
					tickets between a user and server staff, remembering your server's bot configuration, and keeping you logged
					into the dashboard. We don't use your data for advertising, profiling, or anything unrelated to the feature
					you're actually using.
				</p>
			</LegalSection>

			<LegalSection title="4. How long we keep it">
				<p>
					Server configuration, AMA questions, and (where a server has opted in) ModMail transcripts are kept
					indefinitely - this is what powers the dashboard's historical views (past AMA sessions, ticket history,
					snippet usage), which server staff rely on as an ongoing record, not just a live queue. If a feature is
					discontinued, we will purge all data associated with it.
				</p>
				<p>
					Dashboard session cookies expire after 30 days of inactivity. If you'd like something deleted sooner, see
					Section 7 below.
				</p>
				<p>
					A published AMA answers page (see Section 2) stays reachable for as long as the underlying question data does
					- an AMA being marked as ended doesn't take its answers page down. If you'd like a question removed from a
					public answers page, see Section 7 below.
				</p>
			</LegalSection>

			<LegalSection title="5. Who we share it with">
				<p>
					We don't sell, rent, or share your data with third parties. The only place your data goes is Discord's own
					API, because that's how the Service works in the first place. We don't use any third-party analytics,
					advertising, or error-tracking services that your data would pass through.
				</p>
			</LegalSection>

			<LegalSection title="6. Security">
				<p>We take reasonable technical measures to protect your data, including:</p>
				<ul>
					<li>
						Your Discord OAuth tokens are encrypted, not just signed, wherever they're embedded in your session. The
						longer-lived one is only ever transmitted over an <code>httpOnly</code>, secure cookie, never accessible to
						client-side JavaScript; a short-lived (5-minute) one is held in memory by the dashboard itself so it can
						attach it to your requests, and is refreshed automatically.
					</li>
					<li>
						API credentials stored in the database (such as branded ModMail deployments) are encrypted (AES-256-GCM).
					</li>
					<li>Access to production systems is restricted to the ChatSift team.</li>
				</ul>
				<p>
					In the event of a data breach affecting your information, we will notify Discord as required by their
					Developer Terms of Service and post an announcement on our support server.
				</p>
			</LegalSection>

			<LegalSection title="7. Your rights & how to reach us">
				<p>
					If you'd like to know what data we hold about you, or want it deleted, reach out to a ChatSift Team member on
					our <a href="/support">support server</a> - we'll handle it directly.
				</p>
			</LegalSection>

			<LegalSection title="8. Children's privacy">
				<p>
					The Service is only for people who meet Discord's own minimum age requirement (13, or older where local law
					requires it) - we don't knowingly collect data from anyone younger, and access is gated entirely through your
					Discord account.
				</p>
			</LegalSection>

			<LegalSection title="9. Changes to this policy">
				<p>
					We may update this Privacy Policy from time to time. If we make a material change, we'll update the "last
					updated" date above. Continuing to use the Service after a change means you accept the updated policy.
				</p>
			</LegalSection>
		</div>
	);
}
