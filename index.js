import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { generatePassphrase } from "./src/words.js";
import { appendAttendanceRow } from "./src/sheets.js";
import {
  formatRemaining,
  getSession,
  hasCheckedIn,
  isSessionValid,
  loadSession,
  markCheckedIn,
  setSession,
} from "./src/session.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const TOKEN = requireEnv("DISCORD_TOKEN");
const CLIENT_ID = requireEnv("DISCORD_CLIENT_ID");
const GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const SHEET_ID = requireEnv("GOOGLE_SHEET_ID");
const SERVICE_EMAIL = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const PRIVATE_KEY = requireEnv("GOOGLE_PRIVATE_KEY");
const TAB_NAME = process.env.SHEET_TAB_NAME || "Attendance";
const TTL_MINUTES = Number(process.env.PASSWORD_TTL_MINUTES || "20");

const commands = [
  new SlashCommandBuilder()
    .setName("generatepassword")
    .setDescription(
      "Generate a temporary attendance passphrase for this meeting (admins only)",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("attendance")
    .setDescription("Check in to today's robotics meeting with the passphrase")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("password")
        .setDescription("The passphrase announced at the meeting")
        .setRequired(true),
    )
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log(`Registered guild slash commands for ${GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Registered global slash commands (may take up to ~1 hour)");
  }
}

const client = new Client({
  // Slash commands only — no privileged intents needed
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "generatepassword") {
      await handleGeneratePassword(interaction);
      return;
    }
    if (interaction.commandName === "attendance") {
      await handleAttendance(interaction);
      return;
    }
  } catch (err) {
    console.error(err);
    const message =
      err instanceof Error ? err.message : "Something went wrong.";
    const payload = {
      content: `Error: ${message}`,
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

async function handleGeneratePassword(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content:
        "You need **Manage Server** (or Administrator) permission to generate a passphrase.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = Date.now();
  const password = generatePassphrase(3);
  await setSession({
    password,
    createdAt: now,
    expiresAt: now + TTL_MINUTES * 60_000,
    createdBy: interaction.user.id,
    createdByUsername: interaction.user.username,
  });

  await interaction.reply({
    content: [
      `**Meeting passphrase** (expires in ${TTL_MINUTES} minutes):`,
      "",
      `\`${password}\``,
      "",
      "Announce this verbally at the meeting. Students check in with:",
      `\`/attendance password:${password}\``,
      "",
      "_Only you can see this message._",
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAttendance(interaction) {
  const submitted = interaction.options.getString("password", true).trim().toLowerCase();
  const session = getSession();

  if (!isSessionValid(session)) {
    await interaction.reply({
      content:
        "There is no active attendance passphrase right now (or it expired). Ask a mentor/admin to run `/generatepassword`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (submitted !== session.password.toLowerCase()) {
    await interaction.reply({
      content:
        "That passphrase is incorrect. Double-check what was announced at the meeting.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (hasCheckedIn(interaction.user.id)) {
    await interaction.reply({
      content: `You're already checked in for this meeting passphrase. (${formatRemaining(session.expiresAt)} left)`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const displayName =
    interaction.member && "displayName" in interaction.member
      ? interaction.member.displayName
      : interaction.user.globalName || interaction.user.username;

  await appendAttendanceRow({
    sheetId: SHEET_ID,
    tabName: TAB_NAME,
    serviceAccountEmail: SERVICE_EMAIL,
    privateKey: PRIVATE_KEY,
    row: {
      timestamp: new Date().toISOString(),
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
      displayName,
      passphrase: session.password,
      guildId: interaction.guildId || "",
    },
  });

  await markCheckedIn(interaction.user.id);

  await interaction.reply({
    content: `Checked in as **${displayName}**. Thanks — see you at the meeting!\n_(Passphrase expires in ${formatRemaining(session.expiresAt)})_`,
    flags: MessageFlags.Ephemeral,
  });
}

await loadSession();
await registerCommands();
await client.login(TOKEN);
