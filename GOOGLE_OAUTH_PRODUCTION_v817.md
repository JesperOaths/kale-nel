# Kalenel Inbox Triage Agent — Google OAuth production packet (v817)

Updated: 2026-09-26

## Canonical public URLs

- App homepage: https://kalenel.nl/oauth/inbox-triage/
- Privacy policy: https://kalenel.nl/oauth/inbox-triage/privacy.html
- Terms of Service: https://kalenel.nl/oauth/inbox-triage/terms.html
- Support: https://kalenel.nl/oauth/inbox-triage/support.html
- Data deletion / revocation: https://kalenel.nl/oauth/inbox-triage/data-deletion.html
- Authorized domain: kalenel.nl

Legacy /inbox-triage/ pages redirect to the canonical /oauth/inbox-triage/ location and are marked noindex.

## Google Auth Platform → Branding

Recommended values:

- App name: Inbox Triage Agent
- User support email: the monitored Google account used for this project
- App homepage: https://kalenel.nl/oauth/inbox-triage/
- Privacy policy: https://kalenel.nl/oauth/inbox-triage/privacy.html
- Terms of Service: https://kalenel.nl/oauth/inbox-triage/terms.html
- Authorized domain: kalenel.nl
- Developer contact email: prutsalberts@gmail.com (or another monitored address if the project already uses one)

A logo is not needed for the application's private two-account use case. If one is later uploaded to an external production app, Google may require brand verification before displaying it.

## Google Auth Platform → Audience

- User type / audience: External unless the project belongs to a Google Workspace organization and every authorized account is inside that organization.
- Publishing status: In production.

After changing from Testing to In production, reauthorize every configured Gmail account once so the local service receives fresh offline credentials.

## Google Auth Platform → Data Access

Request only:

    https://www.googleapis.com/auth/gmail.modify

Do not add Calendar or unrelated scopes.

### Scope justification

Inbox Triage Agent is a private productivity utility that monitors Gmail inboxes explicitly authorized by their owners. It must read message metadata and message content to determine which new messages require attention and to produce user-requested summaries and optional reply suggestions. After a message has been successfully processed and delivered to the account owner's configured private destination, the application modifies Gmail labels/state so that the same message is not processed repeatedly. A read-only Gmail scope cannot perform that post-processing state update, while label-only or metadata-only access does not provide the message content required for the requested summarization workflow. The application therefore requests gmail.modify as the narrowest Gmail scope that supports the complete user-facing workflow.

## Google user-data / Limited Use description

Inbox Triage Agent accesses Google user data only to provide the user-directed inbox-triage feature. Relevant Gmail content may be sent to the account owner's configured AI processing provider solely to generate the requested summary or reply suggestion. Google Workspace API data is not sold, used for advertising, credit decisions, surveillance or data-broker activity, and is not used to create, train, develop or improve generalized or non-personalized AI/ML models. Human access is not routine and is limited to circumstances permitted by Google's User Data Policy. The application's use and transfer of information received from Google Workspace APIs adheres to the Google User Data Policy, including Limited Use requirements.

## Formal verification reviewer instructions (only if submitting)

1. Open the public homepage and confirm the app identity, functionality, data-purpose explanation and Privacy Policy link.
2. Open Privacy Policy and verify Gmail access, use, storage, sharing, AI processing, revocation/deletion and Limited Use disclosures.
3. Use a reviewer/test Google account authorized for the project.
4. Start the OAuth flow from the private C720P authorization interface.
5. Confirm that the consent screen requests only gmail.modify.
6. Complete authorization.
7. Demonstrate that the service reads a test Gmail message, produces its requested digest/summary, and marks the completed item using its configured Gmail processing state/label.
8. Show that revoking Google access prevents subsequent Gmail API access.

## Suggested verification demo video

Record one continuous screen capture showing:
- Google Cloud project and configured Data Access scope.
- Public Kalenel homepage, Privacy Policy and Terms.
- Starting the authorization flow.
- The Google consent screen with the requested Gmail scope.
- Authorizing a designated test account.
- A harmless test email in that account.
- Inbox Triage Agent processing that email and producing its private digest.
- The resulting Gmail label/state change.
- The data deletion/revocation page.

Do not show OAuth client secrets, refresh tokens, API keys, private Signal credentials, passwords, TOTP secrets or unrelated real email content.

## Personal-use publication path

Google documents a personal-use exception for apps with fewer than 100 users: formal OAuth verification is not mandatory, although users may see an unverified-app warning. The project must still comply with Google API Services / Workspace user-data policies. For the current two-account private deployment, the practical path is:

1. Complete Branding with the canonical Kalenel URLs above.
2. Register kalenel.nl as the authorized domain.
3. Keep only gmail.modify under Data Access.
4. Set Audience / Publishing status to In production.
5. Reauthorize the two Gmail accounts.
6. Accept the unverified-app warning for those explicitly authorized personal accounts if shown.
7. Complete formal restricted-scope verification only if the service is expanded beyond the private personal-use case or removal of the unverified warning is desired.

## Formal restricted-scope verification note

gmail.modify is a restricted Gmail scope. If formal restricted-scope verification is pursued and restricted-scope Google data is stored on or transmitted through servers, Google may require a security assessment. This service transmits selected message content to configured AI processors for a user-requested feature, so a future formal restricted-scope submission should be prepared for that requirement.

## Domain ownership

For formal verification, confirm kalenel.nl ownership in Google Search Console using the same Google account/project relationship expected by Google. Do not fabricate a verification token. If Search Console already reports the domain as verified, no website change is required for this step.

## Current local authorization helper

C720P local UI:

    http://127.0.0.1:8796/

The helper contains the canonical Branding, Data Access and Audience values above and can authorize/verify each configured Gmail account after the project is placed In production.
