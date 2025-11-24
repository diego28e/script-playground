import { SignInButton } from "@/components/auth/sign-in-button";
import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Login - Script Playground",
  description: "Login to your account",
};

export default function LoginPage() {
  return (
    <div className="container relative h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-zinc-900 p-10 text-white lg:flex">
        <Link
          href="/"
          className="relative z-20 flex items-center text-lg font-medium hover:opacity-80 transition-opacity"
        >
          <Image
            src="/logo.png"
            alt="Script Playground Logo"
            width={24}
            height={24}
            className="mr-2 rounded"
          />
          Script Playground
        </Link>
        <div className="relative z-20 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-lg">
              Practice and enhance your logic and coding skills in your
              language. With this app you can get line by line explanation with
              AI if you need it.
            </p>
            <footer className="text-sm">Developed by Diego Espinosa</footer>
          </blockquote>
        </div>
      </div>
      <div className="lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          <div className="flex flex-col space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Create an account
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Enter your email below to create your account
            </p>
          </div>
          <div className="grid gap-6">
            <SignInButton />
            <p className="px-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
              By clicking continue, you agree to our{" "}
              <a
                href="/terms"
                className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
