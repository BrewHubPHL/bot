"use client";

import Image from "next/image";

export default function AboutPage() {
  return (
    <div className="about-page">
      <div className="about-page-card">
        <Image src="/logo.png" alt="BrewHub PHL" width={80} height={80} className="about-logo" priority />
        <h1 className="about-page-title">Our Story</h1>
        <div className="about-page-content">
          <p>
            Every great Philly story starts with a bit of grit and a lot of heart. Before our doors even open in Point Breeze, BrewHub is being built—quite literally—from a living room. While we wait for the sawdust to clear and the hard hats to come off at our physical location, we're busy perfecting what we call the "digital soul" of your new neighborhood hub.
          </p>
          <p>
            We believe coffee is about connection. That's why we created Elise, our friendly digital concierge. She's already live on our site, ready to answer your questions about our upcoming menu—from the perfect pour-over to our signature lattes—and help you join the waitlist for our grand opening.
          </p>
          <p>
            We're not just another coffee shop. We're part of the Philadelphia pulse. When we open, we're not just serving coffee—we're serving the neighborhood. BrewHub is designed to be more than a caffeine stop: it's a workspace with good vibes, reliable Wi-Fi, and a commitment to the local community.
          </p>
          <p>
            At BrewHub, we know modern life is busy. That's why we're also a Parcel Hub—a secure, reliable space for your deliveries. Come for your package, stay for the community, and leave with the best cold brew in South Philly.
          </p>
        </div>
        <a href="/" className="about-back-link">← Back to Home</a>
      </div>
    </div>
  );
}
