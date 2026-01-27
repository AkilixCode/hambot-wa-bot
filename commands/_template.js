const { proto } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'namafitur',
    aliases: ['alias1', 'alias2'],
    category: 'downloader',
    description: 'Deskripsi fitur',
    
    /**
     * @param {import('@whiskeysockets/baileys').WASocket} sock 
     * @param {any} m 
     * @param {string[]} args 
     */
    async execute(sock, m, args) {
        try {
            if (!args[0]) return sock.sendMessage(m.key.remoteJid, { text: 'Masukkan link!' }, { quoted: m });
            
            // Logic here
            await sock.sendMessage(m.key.remoteJid, { react: { text: "⏳", key: m.key } });

        } catch (error) {
            console.error(error);
            await sock.sendMessage(m.key.remoteJid, { text: 'Terjadi kesalahan.' }, { quoted: m });
        }
    }
};
