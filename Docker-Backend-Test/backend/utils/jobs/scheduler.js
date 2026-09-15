const cron = require("node-cron");
const { generateZreport } = require("../../utils");
const Queue = require("../../models/Queue");

async function runScheduledJobs() {

    const jobs = await Queue.query().where("enabled", 1);

    for (const job of jobs) {

        const now = new Date();

        const lastRun = job.last_run ? new Date(job.last_run) : null;

        let shouldRun = false;

        if (!lastRun) {
            shouldRun = true;
        } else {
            const diffHours = (now - lastRun) / (1000 * 60 * 60);
            if (diffHours >= job.interval_hours) {
                shouldRun = true;
            }
        }

        if (shouldRun) {

            await generateZreport(true);

            await Queue.query()
                .where("id", job.id)
                .update({ last_run: new Date() });

        } else {
            console.log("nhi run hounga");
        }
    }

}

function startScheduler() {

    cron.schedule("*/1 * * * *", async () => {
        await runScheduledJobs();
    });

}

module.exports = { startScheduler }; 