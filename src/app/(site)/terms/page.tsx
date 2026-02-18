import Link from "next/link";

export const metadata = {
  title: "Terms & Conditions | BrewHub PHL",
  description: "BrewHub PHL Terms and Conditions for SMS notifications and services.",
};

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <Link href="/" className="inline-block mb-6 text-stone-500 hover:text-stone-900">← Back to BrewHub</Link>
      <h1 className="font-playfair text-3xl mb-2">Terms & Conditions</h1>
      <p className="text-xs text-stone-400 mb-6">Last updated: February 9, 2026</p>
      <h2 className="mt-8 mb-2 text-lg font-bold text-stone-700">BrewHub PHL SMS Notification Program</h2>
      <h3 className="mt-6 mb-1 font-bold">Program Name</h3>
      <p><b>BrewHub Parcel Alerts</b></p>
      <h3 className="mt-6 mb-1 font-bold">Program Description</h3>
      <p>BrewHub PHL offers an SMS notification service for customers who use our parcel hub services. When you sign up for parcel services and provide your phone number, you will receive text message alerts about:</p>
      <ul className="list-disc ml-6 mb-4">
        <li>Package arrivals and delivery notifications</li>
        <li>Pickup reminders for packages waiting at our location</li>
        <li>Service updates related to your mailbox or parcel account</li>
      </ul>
      <h3 className="mt-6 mb-1 font-bold">Message Frequency</h3>
      <p>Message frequency varies based on your parcel activity. You will receive messages only when:</p>
      <ul className="list-disc ml-6 mb-4">
        <li>A new package arrives for you</li>
        <li>A pickup reminder is sent (if package has been waiting)</li>
        <li>Important service updates occur</li>
      </ul>
      <p>Typical customers receive 1-10 messages per month depending on package volume.</p>
      <h3 className="mt-6 mb-1 font-bold">Message and Data Rates</h3>
      <p className="font-bold">Message and data rates may apply.</p>
      <div className="bg-yellow-100 p-4 rounded mb-4">
        <h3 className="font-bold mb-1">How to Get Help or Opt Out</h3>
        <p>Text <b>HELP</b> to +1 (267) 244-1156 for support information.</p>
        <p>Text <b>STOP</b> to +1 (267) 244-1156 to opt out and stop receiving messages at any time.</p>
        <p>After texting STOP, you will receive one final confirmation message and no further messages will be sent.</p>
      </div>
      <h3 className="mt-6 mb-1 font-bold">Support Contact Information</h3>
      <p>For questions, support, or to manage your notification preferences:</p>
      <ul className="list-disc ml-6 mb-4">
        <li><b>Email:</b> <a href="mailto:info@brewhubphl.com" className="underline text-stone-700">info@brewhubphl.com</a></li>
        <li><b>SMS:</b> Text <b>HELP</b> to +1 (267) 244-1156</li>
        <li><b>Location:</b> BrewHub PHL, Point Breeze, Philadelphia, PA 19146</li>
      </ul>
      <h3 className="mt-6 mb-1 font-bold">Consent</h3>
      <p>By providing your phone number and opting in to BrewHub Parcel Alerts, you consent to receive automated text messages at the phone number provided. Consent is not a condition of purchase or service.</p>
      <h3 className="mt-6 mb-1 font-bold">Participating Carriers</h3>
      <p>Supported carriers include AT&T, Verizon, T-Mobile, Sprint, and other major US carriers. Carriers are not liable for delayed or undelivered messages.</p>
      <h2 className="mt-8 mb-2 text-lg font-bold text-stone-700">General Terms of Service</h2>
      <h3 className="mt-6 mb-1 font-bold">Use of Services</h3>
      <p>By using BrewHub PHL services, including our cafe, parcel hub, and mailbox rental services, you agree to these terms. Our services are intended for lawful purposes only.</p>
      <h3 className="mt-6 mb-1 font-bold">Parcel Services</h3>
      <p>BrewHub PHL provides package receiving and holding services. We are not responsible for:</p>
      <ul className="list-disc ml-6 mb-4">
        <li>Packages damaged before arrival at our location</li>
        <li>Packages not picked up within 30 days (subject to disposal)</li>
        <li>Contents of packages or any contraband</li>
      </ul>
      <h3 className="mt-6 mb-1 font-bold">Limitation of Liability</h3>
      <p>BrewHub PHL is not liable for any indirect, incidental, or consequential damages arising from use of our services. Our liability is limited to the fees paid for the specific service in question.</p>
      <h3 className="mt-6 mb-1 font-bold">Changes to Terms</h3>
      <p>We reserve the right to modify these terms at any time. Continued use of our services after changes constitutes acceptance of the new terms.</p>
      <h3 className="mt-6 mb-1 font-bold">Governing Law</h3>
      <p>These terms are governed by the laws of the Commonwealth of Pennsylvania.</p>
      <h2 className="mt-8 mb-2 text-lg font-bold text-stone-700">Contact</h2>
      <p>
        <b>BrewHub PHL</b><br />
        Email: <a href="mailto:info@brewhubphl.com" className="underline text-stone-700">info@brewhubphl.com</a><br />
        Philadelphia, PA 19146
      </p>
      <p className="mt-8">
        <Link href="/privacy" className="underline text-stone-700">View our Privacy Policy</Link>
      </p>
    </main>
  );
}
