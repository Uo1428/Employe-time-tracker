/**
 * *Employee Time Tracker discord bot:
 */
import mongoose, { Schema } from "mongoose";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  Client,
  CommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import config from "./config.js";
import QuickChart from "quickchart-js";

mongoose
  .connect(config.mongodb)
  .then(() => {
    console.log("Connected to db");
  })
  .catch((e) => {
    console.log(e);
  });

const SettingSchema = new Schema({
  GuildId: String,
  EmployeeRoleId: String,
  OnJobRoleId: String,
  ChannelId: String,
  LeaderboardMessageId: String,
});

const Settings = mongoose.model("EmployeeBot:Settings", SettingSchema);

const EmployeeSchema = new Schema({
  GuildId: String,
  UserId: String,
  Username: String,
  StartTime: Number,
  EndTime: Number,
  OnJob: {
    type: Boolean,
    default: false,
  },
  Times: {
    type: [
      {
        day: String,
        time: Number,
      },
    ],
    defaul: [],
  }, // completed times for last 30 days
});

const Employees = mongoose.model("EmployeeBot:Employees", EmployeeSchema);

const client = new Client({
  intents: ["Guilds", "GuildMessages", "MessageContent", "GuildMembers"],
});

/**@type {{data: SlashCommandBuilder, execute: (i: CommandInteraction) => void}[]} */
const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Replies with pong!"),
    execute: (i) => {
      i.reply("Pong!");
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("set")
      .setDescription("settings command")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommandGroup((c) =>
        c
          .setName("employee")
          .setDescription("employee commands")
          .addSubcommand((c) =>
            c
              .setName("role")
              .setDescription("set employee role")
              .addRoleOption((o) =>
                o
                  .setName("role")
                  .setDescription("employee role")
                  .setRequired(true)
              )
          )
      )
      .addSubcommandGroup((c) =>
        c
          .setName("on_job")
          .setDescription("employee commands")
          .addSubcommand((c) =>
            c
              .setName("role")
              .setDescription("set employee role")
              .addRoleOption((o) =>
                o
                  .setName("role")
                  .setDescription("employee role")
                  .setRequired(true)
              )
          )
      ),
    execute: async (i) => {
      const group = i.options.getSubcommandGroup();
      const subcommand = i.options.getSubcommand();
      if (group === "employee") {
        if (subcommand === "role") {
          const role = i.options.getRole("role");
          const guildId = i.guild.id;
          const setting = await Settings.findOne({ GuildId: guildId });
          if (!setting) {
            const newSetting = new Settings({
              GuildId: guildId,
              EmployeeRoleId: role.id,
            });
            await newSetting.save();
            i.reply(`Employee role set to ${role.name}`);
          } else {
            setting.EmployeeRoleId = role.id;
            await setting.save();
            i.reply(`Employee role updated to ${role.name}`);
          }
        }
      } else if (group === "on_job") {
        if (subcommand === "role") {
          const role = i.options.getRole("role");
          const guildId = i.guild.id;
          const setting = await Settings.findOne({ GuildId: guildId });
          if (!setting) {
            const newSetting = new Settings({
              GuildId: guildId,
              OnJobRoleId: role.id,
            });
            await newSetting.save();
            i.reply(`On Job role set to ${role.name}`);
          } else {
            setting.OnJobRoleId = role.id;
            await setting.save();
            i.reply(`On Job role updated to ${role.name}`);
          }
        }
      }
    },
  },
  // command: "/send-leaderboard"
  {
    data: new SlashCommandBuilder()
      .setName("send-panel")
      .setDescription("send panel message")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    execute: async (i) => {
      await i.deferReply({ flags: "Ephemeral" });
      const settings = await Settings.findOne({
        GuildId: i.guild.id,
      });
      if (!settings?.EmployeeRoleId)
        return i.editReply({
          content:
            "Employee Role Not Found, please set employee role, to proceed",
        });
      Settings.updateOne(
        { GuildId: i.guild.id },
        { ChannelId: i.channel.id },
        { upsert: true }
      ).then(async () => {
        await sendLeaderBoard(i.guild.id);
        i.editReply("Leaderboard sent");
        updateLeaderBoard(i.guild.id);
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("show leaderboard")
      .addStringOption((c) =>
        c
          .setName("type")
          .setDescription("type of leadboard")
          .setChoices(
            {
              name: "Last 7 days",
              value: "week",
            },
            {
              name: "Last 30 days",
              value: "month",
            }
          )
          .setRequired(true)
      ),
    execute: async (i) => {
      try {
        await i.deferReply({ flags: "Ephemeral" });
        const type = i.options.getString("type");
        const guildId = i.guild.id;

        const employees = await Employees.find({ GuildId: guildId });
        if (!employees?.length)
          return i.editReply({ content: "❌ No employee data found" });

        const days = type === "week" ? 7 : 30;
        const now = new Date();

        const processedEmployees = employees
          .map((em) => {
            const validTimes = em.Times.filter((t) => {
              const timeDiff =
                now -
                new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  Number.parseInt(t.day)
                );
              const diffDays = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
              return diffDays <= days;
            });

            const totalMinutes =
              validTimes.reduce((acc, cur) => acc + cur.time, 0) / (1000 * 60); // Convert milliseconds to minutes

            const hours = Math.floor(totalMinutes / 60);
            const minutes = Math.floor(totalMinutes % 60);

            return {
              ...em.toObject(),
              totalTime: totalMinutes,
              displayTime: `${hours}h ${minutes}m`,
              validTimes,
            };
          })
          .filter((em) => em.validTimes.length > 0)
          .sort((a, b) => b.totalTime - a.totalTime);

        const embed = new EmbedBuilder()
          .setTitle(
            `${type.charAt(0).toUpperCase() + type.slice(1)}ly Leaderboard`
          )
          .setColor("#0099ff")
          .setDescription(
            processedEmployees.length > 0
              ? processedEmployees
                  .map(
                    (em, index) =>
                      `**${index + 1}.** ${em.Username} - ${em.displayTime}`
                  )
                  .join("\n")
              : "No activity recorded this period"
          )
          .setFooter({ text: `Time period: ${days} days` });

        await i.editReply({ embeds: [embed] });
      } catch (error) {
        console.error("Leaderboard Error:", error);
        await i.editReply({
          content: "❌ An error occurred while processing the leaderboard",
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("stats")
      .setDescription("show user stats")
      .addUserOption((c) =>
        c.setName("user").setDescription("user").setRequired(true)
      ),
    execute: async (i) => {
      await i.deferReply({ flags: "Ephemeral" });
      const user = i.options.getUser("user");
      const guildId = i.guild.id;

      const employee = await Employees.findOne({
        GuildId: guildId,
        UserId: user.id,
      });
      if (!employee) return i.editReply("User not found");

      const now = new Date();
      const validTimes = employee.Times.filter((t) => {
        const timeDiff =
          now -
          new Date(now.getFullYear(), now.getMonth(), Number.parseInt(t.day));
        return Math.floor(timeDiff / (1000 * 60 * 60 * 24)) <= 30;
      }).sort((a, b) => a.day - b.day); // Ensure chronological order

      const avgHours = validTimes.reduce(
        (acc, cur) => acc + cur.time / (1000 * 60 * 60),
        0
      );

      const totalMinutes =
        validTimes.reduce((acc, cur) => acc + cur.time, 0) / (1000 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = Math.floor(totalMinutes % 60);

      const chart = new QuickChart()
        .setVersion("3")
        .setConfig({
          type: "line",
          data: {
            labels: validTimes.map((t) => t.day),
            datasets: [
              {
                label: "Hours Worked",
                data: validTimes.map((t) => t.time / (1000 * 60 * 60)),
                fill: true,
                borderColor: "#00ff99",
                backgroundColor: "rgba(0, 255, 153, 0.1)",
                borderWidth: 2,
                pointBackgroundColor: "#00ff99",
                pointBorderColor: "#00ff99",
                lineTension: 0.4,
                // tension: 2, // Add curve tension
                cubicInterpolationMode: "monotone", // Add smooth curves
              },
            ],
          },
          options: {
            plugins: { legend: { labels: { color: "#ffffff" } } },
            scales: {
              y: {
                beginAtZero: true,
                // grid: { color: "rgba(255, 255, 255, 0.1)" },
                ticks: { color: "#ffffff", callback: (v) => v + "h" },
              },
              x: {
                // grid: { color: "rgba(255, 255, 255, 0.1)" },
                ticks: { color: "#ffffff" },
              },
            },
          },
        })
        .setWidth(800)
        .setHeight(400)
        .setBackgroundColor("#1a1a1a");

      const attachment = new AttachmentBuilder(await chart.toBinary(), {
        name: "chart.png",
      });

      // Create Embed
      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Stats`)
        .setColor("#0099ff")
        .setDescription(
          `- Total Time: ${hours}h ${minutes}m\n- Average Daily Hours: ${avgHours.toFixed(
            1
          )}h\n- Total Shifts: ${validTimes.length}`
        )
        .setImage("attachment://chart.png")
        .setFooter({ text: "Time period: 30 days" });

      await i.editReply({ embeds: [embed], files: [attachment] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("remove")
      .setDescription("remove user from employee list")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((c) =>
        c.setName("user").setDescription("user").setRequired(true)
      ),
    execute: async (i) => {
      await i.deferReply({ flags: "Ephemeral" });
      const user = i.options.getUser("user");
      const guildId = i.guild.id;

      const employee = await Employees.findOne({
        GuildId: guildId,
        UserId: user.id,
      });

      if (!employee) return i.editReply("User not found");

      employee.OnJob = false;

      const calculatedTime = employee.EndTime - employee.StartTime;
      const today = new Date().getDate().toString();

      const todayTime = employee.Times.find((t) => t.day === today);

      if (todayTime) {
        todayTime.time += calculatedTime;
      } else {
        employee.Times.push({
          day: today,
          time: calculatedTime,
        });
      }

      employee.Times = employee.Times.slice(-30);

      await employee.save();
      i.editReply(`Removed ${user.username} from active-employee list`);
      updateLeaderBoard(i.guildId);
      
      // removing job role 
      const settings = await Settings.findOne({
        GuildId: i.guildId
      });
      if(settings?.OnJobRoleId){
        i.member.roles.remove(settings.OnJobRoleId).catch(() => {});
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("reset")
      .setDescription("reset user stats")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((c) =>
        c.setName("user").setDescription("user").setRequired(true)
      ),
    execute: async (i) => {
      await i.deferReply({ flags: "Ephemeral" });
      const user = i.options.getUser("user");
      const guildId = i.guild.id;

      const employee = await Employees.findOne({
        GuildId: guildId,
        UserId: user.id,
      });

      if (!employee) return i.editReply("User not found");

      employee.Times = [];
      employee.StartTime = null;
      employee.EndTime = null;
      employee.OnJob = false;

      await employee.save();

      i.editReply(`Reset ${user.username}'s stats`);
      updateLeaderBoard(i.guildId);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("reset-db")
      .setDescription("reset all data")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    execute: async (i) => {
      await i.deferReply({ flags: "Ephemeral" });
      const guildId = i.guild.id;

      const employees = await Employees.find({ GuildId: guildId });
      if (!employees?.length)
        return i.editReply({ content: "❌ No employee data found" });

      const embed = new EmbedBuilder()
        .setTitle("Reset Data")
        .setDescription(
          "Are you sure you want to reset all data? This action cannot be undone."
        )
        .setColor("#ff0000");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("reset-db:confirm")
          .setLabel("Confirm")
          .setStyle("Danger"),
        new ButtonBuilder()
          .setCustomId("reset-db:cancel")
          .setLabel("Cancel")
          .setStyle("Secondary")
      );

      const message = await i.editReply({
        embeds: [embed],
        components: [row],
      });

      const filter = (interaction) => {
        return (
          interaction.customId === "reset-db:confirm" ||
          interaction.customId === "reset-db:cancel"
        );
      };

      const collector = message.createMessageComponentCollector({
        filter,
        time: 15000,
      });

      collector.on("collect", async (interaction) => {
        if (interaction.customId === "reset-db:confirm") {
          await Employees.deleteMany({ GuildId: guildId });
          await Settings.deleteMany({ GuildId: guildId });
          await i.editReply({
            content: "All data has been reset.",
            embeds: [],
            components: [],
          });
        } else if (interaction.customId === "reset-db:cancel") {
          await i.editReply({
            content: "Reset cancelled.",
            embeds: [],
            components: [],
          });
        }
      });
    },
  },
];

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.application.commands
    .set(commands.map((c) => c.data))
    .then(() => {
      console.log("Commands set");
    })
    .catch(console.error);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    const command = commands.find(
      (c) => c.data.name === interaction.commandName
    );
    command?.execute(interaction);
  }

  if (interaction.isButton()) {
    /**@type {ButtonInteraction} */
    const i = interaction;
    if (interaction.customId === "tracker:start") {
      await i.deferReply({ flags: "Ephemeral" });
      const settings = await Settings.findOne({
        GuildId: i.guild.id,
      });
      if (!settings?.EmployeeRoleId)
        return i.editReply({
          content: "Employee Role Not Found",
        });
      const guildId = i.guild.id;
      const userId = i.user.id;
      const username = i.user.username;

      const isEmployee = i.member.roles.cache.has(settings.EmployeeRoleId);
      if (!isEmployee) return i.editReply("You are not an employee");
      const employeeData = await Employees.findOneAndUpdate(
        {
          UserId: userId,
          GuildId: guildId,
        },
        {},
        {
          upsert: true,
          new: true,
        }
      );

      if (employeeData.OnJob)
        return i.editReply({
          content: "You are already on job",
        });

      employeeData.StartTime = Date.now();
      employeeData.OnJob = true;
      employeeData.Username = username;

      employeeData.save().then(async () => {
        i.editReply({
          content: "You have started your shift",
        });

        i.member.roles.add(settings.OnJobRoleId).catch(console.error);
        await updateLeaderBoard(guildId);
      });
    } else if (i.customId === "tracker:end") {
      await i.deferReply({ flags: "Ephemeral" });
      const settings = await Settings.findOne({
        GuildId: i.guild.id,
      });
      if (!settings?.EmployeeRoleId)
        return i.editReply({
          content: "Employee Role Not Found",
        });
      const guildId = i.guild.id;
      const userId = i.user.id;
      const username = i.user.username;

      const isEmployee = i.member.roles.cache.has(settings.EmployeeRoleId);
      if (!isEmployee) return i.editReply("You are not an employee");
      const employeeData = await Employees.findOneAndUpdate(
        {
          UserId: userId,
          GuildId: guildId,
        },
        {},
        {
          upsert: true,
          new: true,
        }
      );

      if (!employeeData.OnJob)
        return i.editReply({
          content: "You are not on job",
        });

      employeeData.EndTime = Date.now();
      employeeData.OnJob = false;
      employeeData.Username = username;

      const calculatedTime = employeeData.EndTime - employeeData.StartTime;
      const today = new Date().getDate().toString();

      const todayTime = employeeData.Times.find((t) => t.day === today);

      if (todayTime) {
        todayTime.time += calculatedTime;
      } else {
        employeeData.Times.push({
          day: today,
          time: calculatedTime,
        });
      }

      employeeData.Times = employeeData.Times.slice(-30);
      await i.member.roles.remove(settings.OnJobRoleId).catch(console.error);

      employeeData.save().then(() => {
        i.editReply({
          content: "You have ended your shift",
        });
        updateLeaderBoard(guildId);
      });
    } else if (i.customId === "tracker:refresh") {
      await i.deferReply({ flags: "Ephemeral" });
      await updateLeaderBoard(i.guild.id);
      i.editReply({
        content: "Leaderboard refreshed",
      });
    }
  }
});

client.login(config.token);

/**
 * update leaderBoardMessage
 * embed Message must be cool, fancy
 * show the list of active employee with startTime in <t::R>
 */
async function updateLeaderBoard(guildId) {
  const setting = await Settings.findOne({ GuildId: guildId });
  if (!setting) return;
  const channel = client.channels.cache.get(setting.ChannelId);
  if (!channel) return;
  const message = await channel.messages.fetch(setting.LeaderboardMessageId);
  if (!message) return;

  const embed = new EmbedBuilder()
    .setTitle("Employee Time Tracker")
    // .setTimestamp()
    .setColor("Aqua");

  const employees = await Employees.find({
    GuildId: guildId,
    OnJob: true,
  });

  employees.sort((a, b) => b.StartTime - a.StartTime);

  const activeEmployees = employees.filter(
    (e) => e.StartTime > Date.now() - 1000 * 60 * 60 * 24 * 30
  );

  const activeEmployeesList = activeEmployees.map((e) => {
    return `- <@${e.UserId}>: <t:${Math.floor(e.StartTime / 1000)}:R>`;
  });

  embed.setDescription(
    `### Active Employees\n${
      activeEmployeesList.join("\n") || "No active employees"
    }\n\n-# Last Updated: <t:${Math.floor(Date.now() / 1000)}:R>`
  );

  await message.edit({ embeds: [embed] });
}

/**
 * send new cool embeded leaderBoardMessage with buttons (start, end), and delete old one
 */
async function sendLeaderBoard(guildId) {
  const setting = await Settings.findOne({ GuildId: guildId });
  if (!setting) return;
  const channel = client.channels.cache.get(setting.ChannelId);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle("Employee Time Tracker")
    .setDescription("Leaderboard")
    .setColor("Random");

  const row = new ActionRowBuilder().setComponents([
    new ButtonBuilder()
      .setCustomId("tracker:start")
      .setLabel("Start")
      .setStyle(3),
    new ButtonBuilder().setCustomId("tracker:end").setLabel("End").setStyle(4),
    new ButtonBuilder()
      .setCustomId("tracker:refresh")
      .setEmoji("🔃")
      .setStyle(2),
  ]);

  const message = await channel.send({ embeds: [embed], components: [row] });
  setting.LeaderboardMessageId = message.id;
  await setting.save();
}

process.on("uncaughtException", (e) => {
  console.log(e);
});

process.on("unhandledRejection", (e) => {
  console.log(e);
});

process.on("exit", (e) => {
  console.log(e);
});

client.on("error", console.log);
