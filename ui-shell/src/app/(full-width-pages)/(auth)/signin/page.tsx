import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Страница входа | MeshCRM",
  description: "Страница входа в MeshCRM через Keycloak",
};

export default function SignIn() {
  return <SignInForm />;
}
