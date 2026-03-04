const pool = require("./db");

async function seedTasksAndDeadlines() {
  console.log("Seeding tasks and deadlines for all existing cases...");
  
  const { rows: cases } = await pool.query(
    "SELECT id, lead_attorney, case_manager, paralegal, in_litigation, stage, accident_date, statute_of_limitations_date, trial_date, mediation_date FROM cases WHERE deleted_at IS NULL"
  );
  
  console.log(`Found ${cases.length} active cases`);
  
  let tasksCreated = 0;
  let deadlinesCreated = 0;
  
  for (const c of cases) {
    const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    
    const { rows: existingTasks } = await pool.query(
      "SELECT title FROM tasks WHERE case_id = $1",
      [c.id]
    );
    const existingTitles = new Set(existingTasks.map(t => t.title));
    
    const recurringTasks = [
      { title: "Call Client - Attorney Check-in", assigned: c.lead_attorney, assigned_role: "Attorney", due: thirtyDaysOut, recurring: true, recurring_days: 30, notes: "Recurring 30-day attorney check-in call with client" },
      { title: "Call Client - Case Manager Check-in", assigned: c.in_litigation ? c.paralegal : c.case_manager, assigned_role: c.in_litigation ? "Paralegal" : "Case Manager", due: thirtyDaysOut, recurring: true, recurring_days: 30, notes: "Recurring 30-day case manager check-in call with client" },
    ];
    
    const defaultTasks = [
      { title: "Request Medical Records", assigned: c.case_manager, assigned_role: "Case Manager", due: null, notes: "Request all relevant medical records from providers" },
      { title: "Send Representation Letter", assigned: c.lead_attorney, assigned_role: "Attorney", due: null, notes: "Draft and send representation letter to insurance company" },
      { title: "Order Police Report", assigned: c.case_manager, assigned_role: "Case Manager", due: null, notes: "Order police/incident report from relevant agency" },
      { title: "Verify Insurance Coverage", assigned: c.case_manager, assigned_role: "Case Manager", due: null, notes: "Verify all applicable insurance policies and coverage limits" },
      { title: "Send Medical Authorization Forms", assigned: c.case_manager, assigned_role: "Case Manager", due: null, notes: "Send HIPAA authorization forms to client for signature" },
    ];
    
    const allTasks = [...recurringTasks, ...defaultTasks];
    
    for (const t of allTasks) {
      if (existingTitles.has(t.title)) continue;
      try {
        await pool.query(
          `INSERT INTO tasks (case_id, title, assigned, assigned_role, due, priority, status, recurring, recurring_days, is_generated, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [c.id, t.title, t.assigned || null, t.assigned_role || null, t.due || null, "Medium", "Not Started", t.recurring || false, t.recurring_days || null, true, t.notes || ""]
        );
        tasksCreated++;
      } catch (e) { console.error(`Task error for case ${c.id}: ${e.message}`); }
    }
    
    const { rows: existingDeadlines } = await pool.query(
      "SELECT title FROM deadlines WHERE case_id = $1",
      [c.id]
    );
    const existingDlTitles = new Set(existingDeadlines.map(d => d.title));
    
    const deadlines = [];
    if (c.statute_of_limitations_date && !existingDlTitles.has("Statute of Limitations")) {
      deadlines.push({ title: "Statute of Limitations", date: c.statute_of_limitations_date, type: "Court" });
    }
    if (c.trial_date && !existingDlTitles.has("Trial Date")) {
      deadlines.push({ title: "Trial Date", date: c.trial_date, type: "Court" });
    }
    if (c.mediation_date && !existingDlTitles.has("Mediation")) {
      deadlines.push({ title: "Mediation", date: c.mediation_date, type: "Court" });
    }
    
    for (const dl of deadlines) {
      try {
        await pool.query(
          `INSERT INTO deadlines (case_id, title, date, type) VALUES ($1,$2,$3,$4)`,
          [c.id, dl.title, dl.date, dl.type]
        );
        deadlinesCreated++;
      } catch (e) { console.error(`Deadline error for case ${c.id}: ${e.message}`); }
    }
  }
  
  console.log(`Done! Created ${tasksCreated} tasks and ${deadlinesCreated} deadlines.`);
  process.exit(0);
}

seedTasksAndDeadlines().catch(err => { console.error("Seed failed:", err); process.exit(1); });
