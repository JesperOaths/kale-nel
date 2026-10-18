#!/usr/bin/env python3
"""Bounded, read-only Chromium DevTools transport for Step 4 kiosk acceptance.

Chrome may deliver unsolicited websocket events during lazy image loading.
Never allocate memory based on an untrusted 64-bit websocket length field.
Do not log response bodies or IDs, tokens, clip names or private screenshots.
"""
import base64
import json
import os
import socket
import struct
import urllib.request

PORT = 9222
MAX_MESSAGE = 8 * 1024 * 1024

def get(path):
    with urllib.request.urlopen("http://127.0.0.1:%d/%s" % (PORT,path),
                                timeout=6) as response:
        return json.load(response)

class Socket:
    def __init__(self, url):
        host,route=url.split("://",1)[1].split("/",1)
        self.sock=socket.create_connection(("127.0.0.1",PORT),timeout=7)
        self.sock.settimeout(14)
        self.buffer=b""
        self.id=0
        key=base64.b64encode(os.urandom(16)).decode("ascii")
        req=("GET /"+route+" HTTP/1.1\r\nHost: "+host+
             "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
             "Sec-WebSocket-Key: "+key+
             "\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
        self.sock.sendall(req)
        headers=b""
        while b"\r\n\r\n" not in headers:
            chunk=self.sock.recv(1024)
            if not chunk or len(headers)>16384:
                raise RuntimeError("CDP websocket handshake failed")
            headers+=chunk
        head,self.buffer=headers.split(b"\r\n\r\n",1)
        if b" 101 " not in head.split(b"\r\n",1)[0]:
            raise RuntimeError("CDP websocket upgrade refused")

    def _get(self,n):
        if n<0 or n>MAX_MESSAGE:
            raise RuntimeError("CDP response size exceeds safety bound")
        blocks=[]
        remaining=n
        if self.buffer:
            take=min(len(self.buffer),remaining)
            blocks.append(self.buffer[:take])
            self.buffer=self.buffer[take:]
            remaining-=take
        while remaining:
            chunk=self.sock.recv(min(65536,remaining))
            if not chunk:raise RuntimeError("CDP websocket disconnected")
            blocks.append(chunk)
            remaining-=len(chunk)
        return b"".join(blocks)

    def _drop(self,n):
        # Stream-discard unsolicited overlarge events instead of allocating
        # websocket-announced length. Cap utterly absurd lengths as invalid.
        if n>1024*1024*1024:
            raise RuntimeError("Invalid oversized CDP websocket frame")
        while n:
            take=min(n,65536)
            self._get(take)
            n-=take

    def _send(self,body,opcode=1):
        mask=os.urandom(4)
        n=len(body)
        if n<126:head=bytes((0x80|opcode,0x80|n))
        elif n<65536:head=bytes((0x80|opcode,0xfe))+struct.pack("!H",n)
        else:head=bytes((0x80|opcode,0xff))+struct.pack("!Q",n)
        self.sock.sendall(head+mask+bytes(v^mask[i%4] for i,v in enumerate(body)))

    def call(self,method,params=None):
        self.id+=1
        wanted=self.id
        self._send(json.dumps({"id":wanted,"method":method,
                               "params":params or {}}).encode("utf-8"))
        fragments=[]
        total=0
        for _ in range(650):
            a,b=self._get(2)
            opcode=a&0x0f
            fin=bool(a&0x80)
            n=b&127
            if n==126:n=struct.unpack("!H",self._get(2))[0]
            elif n==127:n=struct.unpack("!Q",self._get(8))[0]
            mask=self._get(4) if b&128 else None
            if n>MAX_MESSAGE or n+total>MAX_MESSAGE:
                self._drop(n)
                fragments=[]
                total=0
                if opcode==8:
                    raise RuntimeError("CDP websocket closed")
                continue
            raw=self._get(n)
            if mask:raw=bytes(v^mask[i%4] for i,v in enumerate(raw))
            if opcode==9:
                self._send(raw,opcode=10)
                continue
            if opcode==8:raise RuntimeError("CDP websocket closed")
            if opcode==10:continue
            if opcode not in (0,1,2):continue
            fragments.append(raw)
            total+=len(raw)
            if not fin:continue
            raw=b"".join(fragments)
            fragments=[]
            total=0
            if opcode==2:continue
            try:payload=json.loads(raw)
            except (ValueError,UnicodeError):
                continue
            if payload.get("id") != wanted:
                continue
            if "error" in payload:
                raise RuntimeError("CDP command rejected: "+
                                   str(payload["error"])[:160])
            return payload.get("result",{})
        raise RuntimeError("CDP response not received within bounded event budget")

    def close(self):
        self.sock.close()
