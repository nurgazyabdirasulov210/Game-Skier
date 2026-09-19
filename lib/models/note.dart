import 'package:equatable/equatable.dart';

class Note extends Equatable {
  final String id;
  final String title;
  final String text;

  const Note({required this.id, required this.title, required this.text});

  Note copyWith({String? title, String? text}) {
    return Note(
      id: id,
      title: title ?? this.title,
      text: text ?? this.text,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'text': text,
    };
  }

  factory Note.fromJson(Map<String, dynamic> json) {
    return Note(
      id: json['id'],
      title: json['title'],
      text: json['text'],
    );
  }

  @override
  List<Object> get props => [id, title, text];
}
