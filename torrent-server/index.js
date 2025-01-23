import http from 'http';
import { parse } from 'url';
import bencode from 'bencode';
import { parse as parseQueryString } from 'querystring';
import { MongoClient } from 'mongodb';
import { TextDecoder } from 'util';

const mongoUrl = "mongodb://127.0.0.1:27017/";

const host = 'localhost';
const port = 8000;

function dosome(string) {
    return string;
}

const options = { decodeURIComponent: dosome };

function make_encoded(hash) {
    var alphabet = '0aA';
    var digit0 = alphabet.charCodeAt(0);
    var lowerCaseA = alphabet.charCodeAt(1);
    var upperCaseA = alphabet.charCodeAt(2);
    function decode_char(digit) {
        if (digit >= lowerCaseA)
            return digit - lowerCaseA + 10;
        if (digit >= upperCaseA)
            return digit - upperCaseA + 10;
        return digit - digit0;
    }
    function encode_char(digit) {
        if (digit >= 10)
            return String.fromCharCode(digit - 10 + lowerCaseA);
        else
            return String.fromCharCode(digit + digit0);
    }
    var output = '';
    for (var i = 0; i < hash.length; i += 1) {
        if (hash[i] == '%') {
            output += '%' + hash[i + 1] + hash[i + 2];
            i += 2;
        } else {
            var x0 = hash.charCodeAt(i).toString(16);
            output += '%' + x0;
        }
    }
    return output;
}

const requestListener = function (req, res) {
    res.writeHead(200);

    if (parse(req.url, true).pathname == '/announce') {
        console.log('Received announce request');
        let info_hash = make_encoded(parseQueryString(parse(req.url, false).query, '&', '=', options).info_hash);
        console.log('Parsed info_hash:', info_hash);
        var peers = {};
        MongoClient.connect(mongoUrl, function (err, db) {
            if (err) {
                console.error('Error connecting to MongoDB:', err);
                throw err;
            }
            console.log('Connected to MongoDB');
            var dbo = db.db("torrents");
            dbo.collection("peers").findOne({ [info_hash]: { "$exists": true } }, function (err, result) {
                if (err) {
                    console.error('Error querying MongoDB:', err);
                    throw err;
                }
                if (result) {
                    console.log('Found peers in MongoDB');
                    var peers = encode_peers(result[info_hash]);
                    let peer_str = new TextDecoder().decode(new Uint16Array(peers));
                    var data = {
                        "interval": 1800,
                        "peers": peer_str
                    };
                    var e_data = bencode.encode(data);
                    console.log('Sending response:', data);
                    res.end(e_data);
                    db.close();
                    console.log('Closed MongoDB connection');
                } else {
                    console.log('No peers found in MongoDB');
                    res.end(bencode.encode({ "interval": 1800, "peers": "" }));
                    db.close();
                    console.log('Closed MongoDB connection');
                }
            });
        });
    } else {
        console.log('Received request for unknown path:', parse(req.url, true).pathname);
        res.end();
    }
};

function getInt64Bytes(x) {
    var bytes = [];
    var i = 2;
    do {
        bytes[--i] = x & (255);
        x = x >> 8;
    } while (i);
    return bytes;
}

function encode_peers(peers) {
    var peer_buffer = [];
    var peer_size = 6;
    for (var i = 0; i < peers.length; i++) {
        var ip = peers[i].ip.split(".").map(Number);
        var port = getInt64Bytes(parseInt(peers[i].port, 10));
        peer_buffer = peer_buffer.concat(ip, port);
    }
    return peer_buffer;
}

const server = http.createServer(requestListener);
server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
