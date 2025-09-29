import { Bot, webhookCallback, InputFile } from "https://deno.land/x/grammy/mod.ts";

interface Subscribers {
    subscribe: boolean;
    id: string;
}

const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || 'Your Bot Token';
const bot = new Bot(token);

// ------------------ COMMANDS ------------------

bot.command("start", (ctx) => ctx.reply("Hello! Send /subscribe to start chat with me!", {
  reply_parameters: { message_id: ctx.msg.message_id }
}));

bot.command("subscribe", async (ctx) => {
  const id = ctx.from.id;
  const kv = await Deno.openKv();
  const subscribe = await kv.get(["data", id]);

  if (subscribe?.value?.subscribe) {
    ctx.reply("Sorry, but you already subscribed to me", {
      reply_parameters: { message_id: ctx.msg.message_id }
    });
  } else {
    const scheme: Subscribers = { subscribe: true, id };
    await kv.set(["data", id], scheme);
    ctx.reply("Subscribed to the bot", {
      reply_parameters: { message_id: ctx.msg.message_id }
    });
  }
});

bot.command("unsubscribe", async (ctx) => {
  const id = ctx.from.id;
  const kv = await Deno.openKv();
  await kv.delete(["data", id]);
  await kv.delete(["chats", id]);
  await kv.delete(["prompt", id]);
  ctx.reply("Unsubscribed from the bot", {
    reply_parameters: { message_id: ctx.msg.message_id }
  });
});

bot.command("clear", async (ctx) => {
  const id = ctx.from.id;
  const kv = await Deno.openKv();
  await kv.delete(["chats", id]);
  ctx.reply("Your conversation has been cleared up!", {
    reply_parameters: { message_id: ctx.msg.message_id }
  });
});

bot.command("help", async (ctx) => {
  ctx.reply(`Here are some basic commands to help you navigate and use the AI Telegram Bot:

- /start: Initiates interaction with the bot.
- /subscribe: Subscribes you to the bot for updates.
- /unsubscribe: Unsubscribes you from the bot.
- /clear: Clear your conversation with the bot.
- /help: List of commands.
- /image <prompt>: Generate AI images for free.

Send /subscribe to start interacting!`, {
    reply_parameters: { message_id: ctx.msg.message_id }
  });
});

// ------------------ IMAGE GENERATION ------------------

bot.command("image", async (ctx) => {
  const kv = await Deno.openKv();
  const id = ctx.from.id;
  const subscribe = await kv.get(["data", id]);

  if (!subscribe.value?.subscribe) {
    return ctx.reply("You need to /subscribe first to use this command!", {
      reply_parameters: { message_id: ctx.msg.message_id }
    });
  }

  const prompt = ctx.msg.text.replace("/image", "").trim();
  if (!prompt) {
    return ctx.reply("Please provide a prompt! Usage: /image <your prompt>", {
      reply_parameters: { message_id: ctx.msg.message_id }
    });
  }

  ctx.replyWithChatAction("upload_photo");

  try {
    const response = await fetch(`https://www.craiyon.com/mini?prompt=${encodeURIComponent(prompt)}`);
    const html = await response.text();

    const match = html.match(/"src":"(data:image\/png;base64,[^"]+)"/);
    if (match && match[1]) {
      const imageBase64 = match[1].replace("data:image/png;base64,", "");
      const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      ctx.replyWithPhoto(new InputFile(imageBuffer));
    } else {
      ctx.reply("Could not generate image. Try a different prompt.");
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Something went wrong while generating the image.");
  }
});

// ------------------ CHAT HANDLER ------------------

bot.on("message:text", async (ctx) => {
  try {
    const kv = await Deno.openKv();
    const id = ctx.from.id;
    const subscribe = await kv.get(["data", id]);

    if (subscribe.value?.subscribe) {
      let messageItems: any[] = [];

      try {
        const storedMessages = await kv.get(["chats", id]);
        if (storedMessages && Array.isArray(storedMessages.value)) {
          messageItems = storedMessages.value;
        } else {
          const storedPrompt = await kv.get(["prompt", id]);
          if (storedPrompt.value) {
            messageItems.push({ role: "system", content: storedPrompt.value });
          }
        }
      } catch (err) {
        console.error(err);
      }

      messageItems.push({ role: "user", content: ctx.msg.text });

      const requestBody = {
        model: "meta-llama/Meta-Llama-3-70B-Instruct",
        max_tokens: 300,
        temperature: 0.9,
        messages: messageItems
      };

      ctx.replyWithChatAction("typing");

      const response = await fetch("https://paxsenix-ai.onrender.com/v1/chat/completions", {
        headers: { 
          "Authorization": `Bearer ${Deno.env.get("APIKEY")}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      const text = data.choices[0].message.content;
      messageItems.push({ role: "assistant", content: text });

      try {
        await kv.set(["chats", id], messageItems);
        ctx.reply(text, { reply_parameters: { message_id: ctx.msg.message_id } });
      } catch (error) {
        console.error(error);
      }
    }
  } catch(error) {
    console.error(error);
  }
});

// ------------------ WEBHOOK ------------------

const handleUpdate = webhookCallback(bot, "std/http");

Deno.serve(async (req) => {
  if (req.method === "POST") {
    const url = new URL(req.url);
    if (url.pathname.slice(1) === bot.token) {
      try {
        return await handleUpdate(req);
      } catch (err) {
        console.error(err);
      }
    }
  }
  return new Response();
});