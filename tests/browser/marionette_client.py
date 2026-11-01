"""Minimal Marionette transport for the disposable browser started by run.py."""
import json
import socket


class Marionette:
    def __init__(self, port):
        self.socket = socket.create_connection(('127.0.0.1', port))
        self.socket.settimeout(120)
        self.sequence = 0
        self._read()  # protocol greeting
        self.call('WebDriver:NewSession', {'capabilities': {'alwaysMatch': {}}})
        self.call('WebDriver:SetTimeouts', {'script': 90000, 'pageLoad': 60000, 'implicit': 0})
        self.call('Marionette:SetContext', {'value': 'chrome'})

    def _receive(self, count):
        data = bytearray()
        while len(data) < count:
            chunk = self.socket.recv(count - len(data))
            if not chunk:
                raise ConnectionError('Dedicated browser connection closed')
            data.extend(chunk)
        return bytes(data)

    def _read(self):
        length = bytearray()
        while True:
            character = self._receive(1)
            if character == b':':
                break
            length.extend(character)
        return json.loads(self._receive(int(length)))

    def call(self, name, arguments):
        self.sequence += 1
        body = json.dumps([0, self.sequence, name, arguments]).encode()
        self.socket.sendall(str(len(body)).encode() + b':' + body)
        response = self._read()
        if response[0] != 1 or response[1] != self.sequence:
            raise RuntimeError('Unexpected Marionette response')
        if response[2]:
            raise RuntimeError(response[2])
        return response[3]

    def _execute(self, command, script, arguments):
        return self.call(command, {'script': script, 'args': arguments or [],
                                  'newSandbox': False, 'sandbox': 'system', 'scriptTimeout': 90000})

    def js(self, script, arguments=None):
        return self._execute('WebDriver:ExecuteScript', script, arguments)

    def async_js(self, script, arguments=None):
        return self._execute('WebDriver:ExecuteAsyncScript', script, arguments)
