import "dotenv/config";
import {
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { generatePassphrase } from "./src/words.js";
import { appendSheetRow } from "./src/sheets.js";
import { assertHttpsUrl, logError, userFacingError } from "./src/security.js";
import { randomUUID } from "node:crypto";
import {
  consumePendingCheckout,
  createPendingCheckout,
  findPendingCheckout,
  formatRemaining,
  getPendingCheckoutForUser,
  getSession,
  hasApprovedEarlyLeave,
  hasAttended,
  isSessionValid,
  loadSession,
  markApprovedEarlyLeave,
  markAttended,
  meetingDayFor,
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

function isMentor(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
  );
}

function displayNameOf(interaction) {
  return interaction.member && "displayName" in interaction.member
    ? interaction.member.displayName
    : interaction.user.globalName || interaction.user.username;
}

function isUnknownInteraction(err) {
  return (
    (err instanceof DiscordAPIError && err.code === 10062) ||
    (err && typeof err === "object" && "code" in err && err.code === 10062)
  );
}

/** Every user-visible bot reply must be ephemeral (private to the caller). */
async function replyEphemeral(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
      return;
    }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (err) {
    if (isUnknownInteraction(err)) {
      console.warn("Interaction expired before reply could be sent.");
      return;
    }
    logError("Failed to reply to interaction:", err);
  }
}

async function deferEphemeral(interaction) {
  try {
    if (interaction.deferred || interaction.replied) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (err) {
    if (isUnknownInteraction(err)) {
      console.warn("Interaction expired before defer.");
      return false;
    }
    throw err;
  }
}

const TOKEN = requireEnv("DISCORD_TOKEN");
const CLIENT_ID = requireEnv("DISCORD_CLIENT_ID");
const GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const SHEETS_WEBHOOK_URL = requireEnv("SHEETS_WEBHOOK_URL");
const SHEETS_WEBHOOK_SECRET = requireEnv("SHEETS_WEBHOOK_SECRET");
assertHttpsUrl(SHEETS_WEBHOOK_URL, "SHEETS_WEBHOOK_URL");
const TTL_MINUTES = Number(process.env.PASSWORD_TTL_MINUTES || "20");
const CHECKOUT_TTL_MINUTES = Number(process.env.CHECKOUT_KEY_TTL_MINUTES || "15");

const commands = [
  new SlashCommandBuilder()
    .setName("generatepassword")
    .setDescription(
      "Generate the end-of-meeting attendance passphrase (mentors only)",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("attendance")
    .setDescription(
      "Mark yourself present with the end-of-meeting passphrase",
    )
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("password")
        .setDescription("The passphrase announced verbally at the end of the meeting")
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("checkout")
    .setDescription(
      "Leave early: get a key (students) or approve a key (mentors)",
    )
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("key")
        .setDescription("Mentor only: the student's checkout key to approve")
        .setRequired(false),
    )
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("Registered guild slash commands.");
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Registered global slash commands (may take up to ~1 hour).");
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.on("error", (err) => {
  logError("Discord client error:", err);
});

process.on("unhandledRejection", (err) => {
  logError("Unhandled promise rejection:", err);
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
    if (interaction.commandName === "checkout") {
      await handleCheckout(interaction);
      return;
    }
  } catch (err) {
    logError("Command failed:", err);
    if (isUnknownInteraction(err)) return;
    await replyEphemeral(interaction, userFacingError(err));
  }
});

async function handleGeneratePassword(interaction) {
  if (!isMentor(interaction)) {
    await replyEphemeral(
      interaction,
      "You need **Manage Server** (or Administrator) permission to generate a passphrase.",
    );
    return;
  }

  const now = Date.now();
  const password = generatePassphrase(3);
  const meetingId = randomUUID();
  await setSession({
    password,
    meetingId,
    meetingDay: meetingDayFor(),
    createdAt: now,
    expiresAt: now + TTL_MINUTES * 60_000,
    createdBy: interaction.user.id,
    createdByUsername: interaction.user.username,
  });

  // Ephemeral + verbal announce only — do not encourage pasting the passphrase into chat
  await replyEphemeral(
    interaction,
    [
      `**End-of-meeting attendance passphrase** (expires in ${TTL_MINUTES} minutes):`,
      "",
      `\`${password}\``,
      "",
      "**Announce this out loud** to students still present. Do not post it in Discord chat.",
      "Students then privately run `/attendance` and type the passphrase.",
      "",
      "_Only you can see this message._",
    ].join("\n"),
  );
}

async function handleAttendance(interaction) {
  if (!(await deferEphemeral(interaction))) return;

  const submitted = interaction.options
    .getString("password", true)
    .trim()
    .toLowerCase();
  const session = getSession();

  if (!isSessionValid(session)) {
    await replyEphemeral(
      interaction,
      "There is no active attendance passphrase right now (or it expired). Ask a mentor for help at the end of the meeting.",
    );
    return;
  }

  if (submitted !== session.password.toLowerCase()) {
    await replyEphemeral(
      interaction,
      "That passphrase is incorrect. Ask a mentor to repeat what was announced.",
    );
    return;
  }

  if (hasApprovedEarlyLeave(interaction.user.id)) {
    await replyEphemeral(
      interaction,
      "You already completed an **early leave** today, so end-of-meeting attendance does not apply for you.",
    );
    return;
  }

  if (hasAttended(interaction.user.id)) {
    await replyEphemeral(
      interaction,
      "Your attendance is already recorded for this meeting.",
    );
    return;
  }

  const displayName = displayNameOf(interaction);

  await appendSheetRow({
    webhookUrl: SHEETS_WEBHOOK_URL,
    webhookSecret: SHEETS_WEBHOOK_SECRET,
    type: "attendance",
    row: {
      timestamp: new Date().toISOString(),
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
      displayName,
      // Opaque meeting id only — never send the live passphrase to Google
      meetingId: session.meetingId || "",
      guildId: interaction.guildId || "",
    },
  });

  await markAttended(interaction.user.id);

  await replyEphemeral(
    interaction,
    `Attendance recorded for **${displayName}**.`,
  );
}

async function handleCheckout(interaction) {
  const keyOption = interaction.options.getString("key");

  if (keyOption) {
    await handleMentorApproveCheckout(interaction, keyOption);
    return;
  }

  await handleStudentCheckoutRequest(interaction);
}

async function handleStudentCheckoutRequest(interaction) {
  if (hasApprovedEarlyLeave(interaction.user.id)) {
    await replyEphemeral(
      interaction,
      "A mentor already approved your early leave for this meeting.",
    );
    return;
  }

  if (hasAttended(interaction.user.id)) {
    await replyEphemeral(
      interaction,
      "Your end-of-meeting attendance is already recorded, so early leave is not needed.",
    );
    return;
  }

  const existing = getPendingCheckoutForUser(interaction.user.id);
  if (existing && existing.expiresAt > Date.now()) {
    await replyEphemeral(
      interaction,
      [
        "You already have an active early-leave key. Show this **in person** to a mentor before you leave:",
        "",
        `\`${existing.key}\``,
        "",
        `Expires in ${formatRemaining(existing.expiresAt)}.`,
        "Do not post this key in Discord chat.",
        "",
        "_Only you can see this message._",
      ].join("\n"),
    );
    return;
  }

  const pending = await createPendingCheckout({
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: displayNameOf(interaction),
    guildId: interaction.guildId || "",
    ttlMinutes: CHECKOUT_TTL_MINUTES,
  });

  await replyEphemeral(
    interaction,
    [
      "**Early leave key** — show this **in person** to a mentor before you go:",
      "",
      `\`${pending.key}\``,
      "",
      `Expires in ${CHECKOUT_TTL_MINUTES} minutes.`,
      "Do not post this key in Discord chat.",
      "",
      "_Only you can see this message._",
    ].join("\n"),
  );
}

async function handleMentorApproveCheckout(interaction, key) {
  if (!isMentor(interaction)) {
    await replyEphemeral(
      interaction,
      "Only mentors with **Manage Server** (or Administrator) can approve early-leave keys.",
    );
    return;
  }

  if (!(await deferEphemeral(interaction))) return;

  const pending = findPendingCheckout(key);
  if (!pending) {
    await replyEphemeral(
      interaction,
      "That key is invalid or expired. Ask the student to run `/checkout` again and show you the new key in person.",
    );
    return;
  }

  const consumed = await consumePendingCheckout(key);
  if (!consumed) {
    await replyEphemeral(
      interaction,
      "That key is invalid or expired. Ask the student to run `/checkout` again and show you the new key in person.",
    );
    return;
  }

  await appendSheetRow({
    webhookUrl: SHEETS_WEBHOOK_URL,
    webhookSecret: SHEETS_WEBHOOK_SECRET,
    type: "checkout",
    row: {
      timestamp: new Date().toISOString(),
      discordUserId: consumed.userId,
      discordUsername: consumed.username,
      displayName: consumed.displayName,
      checkoutKey: consumed.key,
      approvedById: interaction.user.id,
      approvedByUsername: interaction.user.username,
      guildId: consumed.guildId || interaction.guildId || "",
    },
  });

  await markApprovedEarlyLeave(consumed.userId, consumed.displayName);

  // Confirm who left — ephemeral to mentor only; do not restate the key
  await replyEphemeral(
    interaction,
    `Approved early leave for **${consumed.displayName}**. Logged to the Checkouts sheet.`,
  );
}

await loadSession();
await registerCommands();
await client.login(TOKEN);
