import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | BrewHub PHL",
  description: "BrewHub PHL Privacy Policy - How we collect, use, and protect your information.",
};

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <Link href="/" className="inline-block mb-6 text-stone-500 hover:text-stone-900">← Back to BrewHub</Link>
      <h1 className="font-playfair text-3xl mb-2">Privacy Policy</h1>
      <p className="text-xs text-stone-400 mb-6">Last updated: February 11, 2026</p>
      <p>BrewHub PHL ("BrewHub," "we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our services.</p>
      <h2 className="mt-8 mb-2 text-lg font-bold text-stone-700">Information We Collect</h2>
      <ul className="list-disc ml-6 mb-4">
        <li><b>Contact Information:</b> Name, email address, and phone number when you sign up for our services, join our waitlist, or register for parcel services.</li>
        <li><b>Parcel Information:</b> Package tracking numbers and delivery details for our parcel hub services.</li>
        <li><b>Account Information:</b> Login credentials for staff and registered customers.</li>
      </ul>
      <h2 className="mt-8 mb-2 text-lg font-bold text-stone-700">How We Use Your Information</h2>
      <ul className="list-disc ml-6 mb-4">
        <li><b>Parcel Notifications:</b> To send SMS and email alerts when your packages arrive or are ready for pickup.</li>
        <li><b>Service Updates:</b> To notify you about your mailbox rental, orders, or account status.</li>
        <li><b>Waitlist Communications:</b> To inform you about our grand opening and special offers (only if you opted in).</li>
      </ul>
      <h2 className="mt-8 mb-2 text-lg font-bold text-stone-700">SMS/Text Message Policy</h2>
      <ul className="list-disc ml-6 mb-4">
        <li>Package arrival notifications</li>
        <li>Pickup reminders</li>
        <li>Service-related alerts</li>
      </ul>
      <p className="mb-2 font-bold">Message frequency varies based on parcel activity. Message and data rates may apply.</p>
      <p>To opt out of SMS notifications, reply STOP to any message or contact us at <a href="mailto:info@brewhubphl.com" className="underline text-stone-700">info@brewhubphl.com</a>.</p>
    </main>
  );
}
