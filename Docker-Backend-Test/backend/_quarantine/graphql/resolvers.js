const { redisClient } = require("../redis");
const db = require("../db");

const resolvers = {
    Query: {

        tables: async () => {

            const cache = await redisClient.get("tables");

            if (cache) {
                console.log("⚡ Tables from Redis");
                return JSON.parse(cache);
            }

            const tables = await db("tables").select("*");

            await redisClient.set("tables", JSON.stringify(tables), {
                EX: 60
            });

            return tables;
        },

        menu: async () => {

            const cache = await redisClient.get("menu");

            if (cache) {
                console.log("⚡ Menu from Redis");
                return JSON.parse(cache);
            }

            const items = await db("items").select("*");

            await redisClient.set("menu", JSON.stringify(items), {
                EX: 60
            });

            return items;
        }

    }
};

module.exports = resolvers;