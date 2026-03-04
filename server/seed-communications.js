const pool = require("./db");

const TEMPLATES = [
  { subject: "Intake Follow-up", body: "Thank you for choosing our firm. We wanted to follow up on your initial consultation and let you know that we've begun reviewing your case. Please don't hesitate to reach out if you have any questions.", from: "firm" },
  { subject: "Medical Update Request", body: "We hope you're doing well. Could you please provide us with an update on your medical treatment? Specifically, we'd like to know about any recent doctor visits, changes in treatment, or new symptoms you may be experiencing.", from: "firm" },
  { subject: "RE: Medical Update Request", body: "Hi, I had my follow-up appointment last week. The doctor said I'm making progress but still need physical therapy twice a week. I also started seeing a chiropractor. Let me know if you need the new provider's information.", from: "client" },
  { subject: "Insurance Question", body: "I received a call from the other driver's insurance company asking me questions about the accident. Should I talk to them? I didn't give them any information yet but wanted to check with you first.", from: "client" },
  { subject: "RE: Insurance Question", body: "Great question - please do not speak with the other party's insurance company directly. Forward any calls or correspondence to our office and we will handle all communications on your behalf. This is very important for protecting your case.", from: "firm" },
  { subject: "Status Check", body: "Hi, I just wanted to check in on the status of my case. It's been a few weeks since we last spoke and I wanted to make sure everything is still moving forward. Thank you.", from: "client" },
  { subject: "RE: Status Check", body: "Thank you for reaching out. Your case is progressing well. We've sent the representation letter to the insurance company and are currently gathering all medical records. We expect to have a demand package ready within the next 60-90 days.", from: "firm" },
  { subject: "Document Notice", body: "We need you to sign and return the enclosed medical authorization forms as soon as possible. These forms allow us to request your medical records directly from your healthcare providers. Please return them within 5 business days.", from: "firm" },
  { subject: "RE: Document Notice", body: "I signed the forms and uploaded them through the portal. Please let me know if you need anything else from me.", from: "client" },
  { subject: "Appointment Reminder", body: "This is a reminder that you have a scheduled appointment with our office next Tuesday at 2:00 PM. Please bring any new medical bills or documents related to your case. Let us know if you need to reschedule.", from: "firm" },
  { subject: "Property Damage Question", body: "I just received an estimate for my car repairs. The total is $4,200. The insurance company is saying my car might be a total loss. What should I do?", from: "client" },
  { subject: "Treatment Completion", body: "My doctor said I've reached maximum medical improvement and discharged me from treatment today. I still have some pain but he said there's nothing more they can do. What happens next with my case?", from: "client" },
];

async function seedCommunications() {
  console.log("Seeding fake client communications...");

  const { rows: cases } = await pool.query(
    "SELECT id, client_name FROM cases WHERE deleted_at IS NULL"
  );

  console.log(`Found ${cases.length} active cases`);

  let created = 0;

  for (const c of cases) {
    const numMessages = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...TEMPLATES].sort(() => Math.random() - 0.5).slice(0, numMessages);
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - Math.floor(Math.random() * 60) - 10);

    for (let i = 0; i < shuffled.length; i++) {
      const t = shuffled[i];
      const msgDate = new Date(baseDate.getTime() + i * (1 + Math.random() * 3) * 24 * 60 * 60 * 1000);
      const clientName = c.client_name || "Client";
      const clientEmail = clientName.toLowerCase().replace(/\s+/g, ".") + "@email.com";

      try {
        await pool.query(
          `INSERT INTO case_correspondence (case_id, from_email, from_name, to_emails, subject, body_text, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            c.id,
            t.from === "client" ? clientEmail : "firm@mitchellpi.com",
            t.from === "client" ? clientName : "Mitchell PI Law Firm",
            t.from === "client" ? "firm@mitchellpi.com" : clientEmail,
            t.subject,
            t.body,
            msgDate.toISOString(),
          ]
        );
        created++;
      } catch (e) {
        console.error(`Comm error for case ${c.id}: ${e.message}`);
      }
    }
  }

  console.log(`Done! Created ${created} fake communications.`);
  process.exit(0);
}

seedCommunications().catch(err => { console.error("Seed failed:", err); process.exit(1); });
