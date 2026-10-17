/**
 * An incremental server-sent-events parser, following the WHATWG event
 * stream format that all three providers use for streaming. Chunks from the
 * network can split anywhere, even inside a line or a UTF-8 character, so
 * text is buffered until each line is complete.
 */

/** One dispatched event. */
export interface SseEvent {
	/** The `event:` field, when the stream names its events (as Anthropic does). */
	event?: string;
	/** The `data:` lines, joined with newlines. */
	data: string;
}

/** Parses an event stream incrementally. Feed it chunks with `push`, then call `end`. */
export class SseParser {
	private readonly decoder = new TextDecoder();
	private buffer = '';
	private eventName: string | undefined;
	private dataLines: string[] = [];

	/** Adds a chunk of the stream and returns the events it completed. */
	push(chunk: Uint8Array | string): SseEvent[] {
		this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
		return this.drain(false);
	}

	/** Ends the stream, returning any event the stream ended without a blank line after. */
	end(): SseEvent[] {
		this.buffer += this.decoder.decode();
		return this.drain(true);
	}

	private drain(final: boolean): SseEvent[] {
		const events: SseEvent[] = [];
		for (;;) {
			const match = /\r\n|\r|\n/u.exec(this.buffer);
			// A trailing \r may be the first half of \r\n, so wait for more unless the stream has ended.
			if (!match || (match[0] === '\r' && match.index === this.buffer.length - 1 && !final)) break;
			const line = this.buffer.slice(0, match.index);
			this.buffer = this.buffer.slice(match.index + match[0].length);
			this.line(line, events);
		}
		if (final) {
			if (this.buffer !== '') this.line(this.buffer, events);
			this.buffer = '';
			this.dispatch(events);
		}
		return events;
	}

	private line(line: string, events: SseEvent[]): void {
		if (line === '') {
			this.dispatch(events);
			return;
		}
		// Lines starting with a colon are comments, often sent as keep-alives.
		if (line.startsWith(':')) return;
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') this.dataLines.push(value);
		else if (field === 'event') this.eventName = value;
	}

	private dispatch(events: SseEvent[]): void {
		if (this.dataLines.length > 0) {
			const event: SseEvent = { data: this.dataLines.join('\n') };
			if (this.eventName !== undefined) event.event = this.eventName;
			events.push(event);
		}
		this.dataLines = [];
		this.eventName = undefined;
	}
}
