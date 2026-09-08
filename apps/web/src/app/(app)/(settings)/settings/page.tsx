import type { Metadata } from "next";
import { currentUser } from "@/lib/api-server";
import { getOwners } from "./data";
import { NameForm, PasswordForm, RecoveryCodesForm } from "./forms";
import { Fact, Facts, Field, PageHead } from "./ui";

export const metadata: Metadata = { title: "Account · Settings" };

export default async function AccountPage() {
  const [me, owners] = await Promise.all([currentUser(), getOwners()]);
  const self = owners.find((o) => o.isYou);

  return (
    <>
      <PageHead title="Account">
        Who you are to this vault, and how you get back into it. There is deliberately no password reset by email — an
        address that can reset your vault is a second lock nobody in this house controls.
      </PageHead>

      <Facts>
        <Fact k="Email">{me?.email ?? "—"}</Fact>
        <Fact k="Two-factor">Authenticator app, required</Fact>
        <Fact k="Recovery codes">{self ? `${self.recoveryCodesLeft} of 10 unused` : "—"}</Fact>
      </Facts>

      <Field label="Name" hint="However you want to be called — it is shown beside your name in this household and is not used to sign in.">
        <NameForm current={me?.displayName ?? ""} />
      </Field>

      <Field label="Password" hint="At least 12 characters. Changing it keeps your other sessions signed in; sign them out under Devices if that is what you meant to do.">
        <PasswordForm />
      </Field>

      <Field
        label="Recovery codes"
        hint="The only way back in if you lose your authenticator. Regenerating prints a new set and retires the old one immediately, so print the new codes before you close the page."
      >
        <RecoveryCodesForm />
      </Field>
    </>
  );
}
